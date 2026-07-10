package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AlertGeneratorService mengelola pembuatan dan manajemen alerts
type AlertGeneratorService interface {
	GenerateAlertsForAllUsers(ctx context.Context) error
	GenerateAlertsForUser(ctx context.Context, ownerID string) error
}

type alertGeneratorService struct {
	dbPool          *pgxpool.Pool
	telegramService TelegramService
}

func NewAlertGeneratorService(dbPool *pgxpool.Pool, telegramService TelegramService) AlertGeneratorService {
	return &alertGeneratorService{
		dbPool:          dbPool,
		telegramService: telegramService,
	}
}

// GenerateAlertsForAllUsers iterates all active owner users and generates alerts
func (s *alertGeneratorService) GenerateAlertsForAllUsers(ctx context.Context) error {
	rows, err := s.dbPool.Query(ctx, `
		SELECT id FROM users WHERE role = 'owner' AND is_active = true AND deleted_at IS NULL
	`)
	if err != nil {
		return fmt.Errorf("failed to fetch users: %w", err)
	}
	defer rows.Close()

	var userIDs []string
	for rows.Next() {
		var uid string
		if scanErr := rows.Scan(&uid); scanErr == nil {
			userIDs = append(userIDs, uid)
		}
	}

	for _, uid := range userIDs {
		_ = s.GenerateAlertsForUser(ctx, uid)
	}
	return nil
}

func (s *alertGeneratorService) GenerateAlertsForUser(ctx context.Context, ownerID string) error {
	// 1. Tagihan OVERDUE (danger)
	s.scanOverdueBills(ctx, ownerID)

	// 2. Forecast saldo < 0 (danger)
	s.scanForecastNegative(ctx, ownerID)

	// 3. EF < 3 bulan (danger)
	s.scanEFLow(ctx, ownerID)

	// 4. Tagihan H-1 (warning)
	s.scanBillsDueSoon(ctx, ownerID, 1, "warning", "bill_due_h1")

	// 5. Budget > 100% (warning)
	s.scanBudgetOverLimit(ctx, ownerID, 100, "warning", "budget_over")

	// 6. Tagihan H-3 (warning)
	s.scanBillsDueSoon(ctx, ownerID, 3, "warning", "bill_due_h3")

	// 7. Budget > 80% (warning)
	s.scanBudgetOverLimit(ctx, ownerID, 80, "warning", "budget_near_limit")

	// 8. Subscription renewal (info)
	s.scanSubscriptionRenewal(ctx, ownerID)

	return nil
}

// insertAlertIfNotExists inserts alert only if no non-dismissed alert of same type+entity_id exists
func (s *alertGeneratorService) insertAlertIfNotExists(ctx context.Context,
	ownerID, alertType, severity, title, message, actionURL, actionLabel, entityType, entityID string,
	expiresAt *time.Time,
) bool {
	// Check duplicate — if existing not-dismissed alert of same type + entity_id exists, skip
	var existingCount int
	checkQuery := `
		SELECT COUNT(*) FROM alerts
		WHERE user_id = $1 AND type = $2 AND is_dismissed = false
	`
	args := []interface{}{ownerID, alertType}

	if entityID != "" {
		checkQuery += " AND entity_id::text = $3"
		args = append(args, entityID)
	}

	_ = s.dbPool.QueryRow(ctx, checkQuery, args...).Scan(&existingCount)
	if existingCount > 0 {
		return false // duplicate
	}

	var entityIDArg interface{}
	if entityID != "" {
		entityIDArg = entityID
	}

	_, err := s.dbPool.Exec(ctx, `
		INSERT INTO alerts (user_id, type, severity, title, message, action_url, action_label, entity_type, entity_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10)
	`, ownerID, alertType, severity, title, message, actionURL, actionLabel, entityType, entityIDArg, expiresAt)

	if err != nil {
		return false
	}

	// Send Telegram for danger alerts
	if severity == "danger" {
		_ = s.telegramService.SendMessage(title, message, actionLabel)
	}

	return true
}

// 1. Tagihan overdue (danger)
func (s *alertGeneratorService) scanOverdueBills(ctx context.Context, ownerID string) {
	rows, _ := s.dbPool.Query(ctx, `
		SELECT id, name, amount, next_due_date FROM bills
		WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL
		  AND next_due_date < CURRENT_DATE
	`, ownerID)
	if rows == nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, name string
		var amount float64
		var dueDate time.Time
		if err := rows.Scan(&id, &name, &amount, &dueDate); err == nil {
			title := fmt.Sprintf("Tagihan Jatuh Tempo: %s", name)
			msg := fmt.Sprintf("Tagihan %s sebesar %s telah jatuh tempo pada %s dan belum dibayar.",
				name, formatRupiah(amount), dueDate.Format("02 Jan 2006"))
			s.insertAlertIfNotExists(ctx, ownerID, "bill_overdue", "danger",
				title, msg, "/bills", "Bayar Sekarang", "bill", id, nil)
		}
	}
}

// 2. Forecast saldo < 0 (danger)
func (s *alertGeneratorService) scanForecastNegative(ctx context.Context, ownerID string) {
	var forecastBalance float64
	err := s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0) FROM accounts
		WHERE user_id = $1 AND type IN ('bank', 'e_wallet', 'cash') AND deleted_at IS NULL AND is_active = true
	`, ownerID).Scan(&forecastBalance)
	if err != nil {
		return
	}

	// Get monthly scheduled bills total
	var monthlyBills float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM bills
		WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL
	`, ownerID).Scan(&monthlyBills)

	projectedBalance := forecastBalance - monthlyBills
	if projectedBalance < 0 {
		title := "Peringatan: Proyeksi Saldo Negatif!"
		msg := fmt.Sprintf("Setelah memperhitungkan tagihan bulanan %s, saldo kas diproyeksikan menjadi %s bulan ini.",
			formatRupiah(monthlyBills), formatRupiah(projectedBalance))
		s.insertAlertIfNotExists(ctx, ownerID, "forecast_negative", "danger",
			title, msg, "/forecast", "Lihat Forecast", "", "", nil)
	}
}

// 3. EF < 3 bulan (danger)
func (s *alertGeneratorService) scanEFLow(ctx context.Context, ownerID string) {
	var efTotal, monthlyLivingCost float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0) FROM accounts
		WHERE user_id = $1 AND is_emergency_fund = true AND is_active = true AND deleted_at IS NULL
	`, ownerID).Scan(&efTotal)

	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(monthly_living_cost_override, 0) FROM emergency_fund_configs WHERE user_id = $1
	`, ownerID).Scan(&monthlyLivingCost)

	if monthlyLivingCost <= 0 {
		return
	}

	coverageMonths := efTotal / monthlyLivingCost
	if coverageMonths < 3 {
		title := "Dana Darurat Tidak Mencukupi!"
		msg := fmt.Sprintf("Dana darurat Anda hanya mencukupi %.1f bulan. Minimum ideal adalah 3 bulan (%.0f bulan direkomendasikan).",
			coverageMonths, math.Ceil(coverageMonths))
		s.insertAlertIfNotExists(ctx, ownerID, "ef_low", "danger",
			title, msg, "/emergency-fund", "Tambah Dana Darurat", "", "", nil)
	}
}

// 4 & 6. Tagihan H-N (warning)
func (s *alertGeneratorService) scanBillsDueSoon(ctx context.Context, ownerID string, days int, severity, alertType string) {
	targetDate := time.Now().AddDate(0, 0, days)
	rows, _ := s.dbPool.Query(ctx, `
		SELECT id, name, amount, next_due_date FROM bills
		WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL
		  AND next_due_date::date = $2::date
	`, ownerID, targetDate.Format("2006-01-02"))
	if rows == nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, name string
		var amount float64
		var dueDate time.Time
		if err := rows.Scan(&id, &name, &amount, &dueDate); err == nil {
			title := fmt.Sprintf("Tagihan Jatuh Tempo dalam %d Hari: %s", days, name)
			msg := fmt.Sprintf("Tagihan %s sebesar %s akan jatuh tempo pada %s.",
				name, formatRupiah(amount), dueDate.Format("02 Jan 2006"))
			s.insertAlertIfNotExists(ctx, ownerID, alertType, severity,
				title, msg, "/bills", "Lihat Tagihan", "bill", id, nil)
		}
	}
}

// 5 & 7. Budget over limit
func (s *alertGeneratorService) scanBudgetOverLimit(ctx context.Context, ownerID string, pctThreshold float64, severity, alertType string) {
	currentMonth := time.Now().Format("2006-01")

	rows, _ := s.dbPool.Query(ctx, `
		SELECT b.id, c.name, b.amount,
		  COALESCE((
		    SELECT SUM(t.amount) FROM transactions t
		    WHERE t.user_id = $1 AND t.category_id = b.category_id AND t.type = 'expense'
		      AND t.status = 'confirmed' AND TO_CHAR(t.date, 'YYYY-MM') = $2 AND t.deleted_at IS NULL AND t.is_split = false
		  ), 0) + COALESCE((
		    SELECT SUM(s.amount) FROM transaction_splits s
		    JOIN transactions t ON s.transaction_id = t.id
		    WHERE t.user_id = $1 AND s.category_id = b.category_id AND t.type = 'expense'
		      AND t.status = 'confirmed' AND TO_CHAR(t.date, 'YYYY-MM') = $2 AND t.deleted_at IS NULL
		  ), 0) AS spent
		FROM budgets b
		JOIN categories c ON b.category_id = c.id
		WHERE b.user_id = $1 AND b.month = $2
	`, ownerID, currentMonth)
	if rows == nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, catName string
		var budgetAmt, spent float64
		if err := rows.Scan(&id, &catName, &budgetAmt, &spent); err == nil && budgetAmt > 0 {
			pct := (spent / budgetAmt) * 100
			if pct >= pctThreshold {
				title := fmt.Sprintf("Budget %s Melebihi %.0f%%", catName, pctThreshold)
				msg := fmt.Sprintf("Pengeluaran kategori %s sudah mencapai %.0f%% dari anggaran (%s dari %s).",
					catName, pct, formatRupiah(spent), formatRupiah(budgetAmt))
				s.insertAlertIfNotExists(ctx, ownerID, alertType, severity,
					title, msg, "/budgets", "Lihat Anggaran", "budget", id, nil)
			}
		}
	}
}

// 8. Subscription renewal (info)
func (s *alertGeneratorService) scanSubscriptionRenewal(ctx context.Context, ownerID string) {
	// Check for bills with billing_cycle that are due within 7 days
	rows, _ := s.dbPool.Query(ctx, `
		SELECT id, name, amount, next_due_date FROM bills
		WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL
		  AND next_due_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
		  AND billing_cycle IN ('monthly', 'yearly', 'quarterly')
	`, ownerID)
	if rows == nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, name string
		var amount float64
		var dueDate time.Time
		if err := rows.Scan(&id, &name, &amount, &dueDate); err == nil {
			daysLeft := int(time.Until(dueDate).Hours() / 24)
			title := fmt.Sprintf("Pembaruan Langganan: %s", name)
			msg := fmt.Sprintf("Langganan %s sebesar %s akan diperbarui dalam %d hari pada %s.",
				name, formatRupiah(amount), daysLeft, dueDate.Format("02 Jan 2006"))
			s.insertAlertIfNotExists(ctx, ownerID, "subscription_renewal", "info",
				title, msg, "/bills", "Lihat Detail", "bill", id, nil)
		}
	}
}

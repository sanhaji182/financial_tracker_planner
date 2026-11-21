package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

// InsightService manages monthly financial insight generation and retrieval
type InsightService interface {
	GetInsights(ctx context.Context, userID string, month string) (*dto.InsightsListResponse, error)
	GenerateInsights(ctx context.Context, userID string, month string) (*dto.InsightsListResponse, error)
}

type insightService struct {
	dbPool *pgxpool.Pool
}

// NewInsightService creates a new InsightService instance
func NewInsightService(dbPool *pgxpool.Pool) InsightService {
	return &insightService{dbPool: dbPool}
}

func (s *insightService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
	var role string
	var invitedBy *string
	err := s.dbPool.QueryRow(ctx, `
		SELECT role, invited_by FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&role, &invitedBy)
	if err != nil {
		return "", err
	}
	if role == "spouse_viewer" && invitedBy != nil && *invitedBy != "" {
		return *invitedBy, nil
	}
	return userID, nil
}

// GetInsights fetches stored insights for a given month
func (s *insightService) GetInsights(ctx context.Context, userID string, month string) (*dto.InsightsListResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	if month == "" {
		month = time.Now().Format("2006-01")
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id, user_id, month, insight_type, title, description, data, severity, sort_order, created_at
		FROM monthly_insights
		WHERE user_id = $1 AND month = $2
		ORDER BY sort_order ASC, created_at ASC
	`, ownerID, month)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch insights: %w", err)
	}
	defer rows.Close()

	insights := []dto.MonthlyInsightResponse{}
	for rows.Next() {
		var ins dto.MonthlyInsightResponse
		var rawData []byte
		err := rows.Scan(&ins.ID, &ins.UserID, &ins.Month, &ins.InsightType,
			&ins.Title, &ins.Description, &rawData, &ins.Severity, &ins.SortOrder, &ins.CreatedAt)
		if err != nil {
			continue
		}
		if rawData != nil {
			_ = json.Unmarshal(rawData, &ins.Data)
		}
		insights = append(insights, ins)
	}

	// If no stored insights, auto-generate for this month
	if len(insights) == 0 {
		return s.GenerateInsights(ctx, userID, month)
	}

	return &dto.InsightsListResponse{
		Month:    month,
		Insights: insights,
	}, nil
}

// GenerateInsights auto-calculates all 6 insight types and stores them (replaces existing)
func (s *insightService) GenerateInsights(ctx context.Context, userID string, month string) (*dto.InsightsListResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	if month == "" {
		month = time.Now().Format("2006-01")
	}

	// Parse the target month
	targetDate, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, fmt.Errorf("invalid month format, use YYYY-MM: %w", err)
	}

	// Delete existing insights for this month (full regenerate)
	_, _ = s.dbPool.Exec(ctx, `
		DELETE FROM monthly_insights WHERE user_id = $1 AND month = $2
	`, ownerID, month)

	monthStart := targetDate
	monthEnd := targetDate.AddDate(0, 1, 0).Add(-time.Nanosecond)

	// Calculate 3-month lookback window for trend comparison
	threeMonthsAgo := monthStart.AddDate(0, -3, 0)
	oneMonthAgo := monthStart.AddDate(0, -1, 0)

	var generatedInsights []dto.MonthlyInsightResponse
	sortOrder := 0

	// ═══════════════════════════════════════════════════════
	// 1. TOP CATEGORIES — top 3 pengeluaran terbesar bulan ini
	// ═══════════════════════════════════════════════════════
	{
		type catSpend struct {
			Name   string
			Amount float64
		}
		catRows, err := s.dbPool.Query(ctx, `
			SELECT c.name, SUM(t.amount) as total
			FROM transactions t
			JOIN categories c ON t.category_id = c.id
			WHERE t.user_id = $1
			  AND t.type = 'expense'
			  AND t.status = 'confirmed'
			  AND t.deleted_at IS NULL
			  AND t.date >= $2 AND t.date <= $3
			GROUP BY c.name
			ORDER BY total DESC
			LIMIT 3
		`, ownerID, monthStart.Format("2006-01-02"), monthEnd.Format("2006-01-02"))

		if err == nil {
			defer catRows.Close()
			var topCats []catSpend
			for catRows.Next() {
				var cs catSpend
				if err := catRows.Scan(&cs.Name, &cs.Amount); err == nil {
					topCats = append(topCats, cs)
				}
			}
			catRows.Close()

			if len(topCats) > 0 {
				// Build description
				parts := []string{}
				cats := []dto.InsightDataCategory{}
				for _, c := range topCats {
					parts = append(parts, fmt.Sprintf("%s Rp %.0f", c.Name, c.Amount))
					cats = append(cats, dto.InsightDataCategory{Name: c.Name, Amount: c.Amount})
				}
				desc := "Pengeluaran terbesar bulan ini: " + strings.Join(parts, ", ")

				data := dto.InsightData{Categories: cats}
				rawData, _ := json.Marshal(data)

				ins := s.insertInsight(ctx, ownerID, month, "top_categories",
					"🏆 Top Kategori Pengeluaran", desc, rawData, "neutral", sortOrder)
				if ins != nil {
					generatedInsights = append(generatedInsights, *ins)
					sortOrder++
				}
			}
		}
	}

	// ═══════════════════════════════════════════════════════
	// 2. SPENDING INCREASE — bandingkan vs rata-rata 3 bulan lalu
	// ═══════════════════════════════════════════════════════
	{
		type catTrend struct {
			Name         string
			CurrentMonth float64
			AvgPrev3     float64
			ChangePercent float64
		}

		// Get current month spending per category
		currentRows, err := s.dbPool.Query(ctx, `
			SELECT c.name, SUM(t.amount) as total
			FROM transactions t
			JOIN categories c ON t.category_id = c.id
			WHERE t.user_id = $1
			  AND t.type = 'expense'
			  AND t.status = 'confirmed'
			  AND t.deleted_at IS NULL
			  AND t.date >= $2 AND t.date <= $3
			GROUP BY c.name
		`, ownerID, monthStart.Format("2006-01-02"), monthEnd.Format("2006-01-02"))

		if err == nil {
			defer currentRows.Close()
			currentMap := map[string]float64{}
			for currentRows.Next() {
				var name string
				var amt float64
				if err := currentRows.Scan(&name, &amt); err == nil {
					currentMap[name] = amt
				}
			}
			currentRows.Close()

			// Get 3-month avg per category
			avgRows, err := s.dbPool.Query(ctx, `
				SELECT c.name, SUM(t.amount) / 3.0 as avg_monthly
				FROM transactions t
				JOIN categories c ON t.category_id = c.id
				WHERE t.user_id = $1
				  AND t.type = 'expense'
				  AND t.status = 'confirmed'
				  AND t.deleted_at IS NULL
				  AND t.date >= $2 AND t.date < $3
				GROUP BY c.name
			`, ownerID, threeMonthsAgo.Format("2006-01-02"), monthStart.Format("2006-01-02"))

			if err == nil {
				defer avgRows.Close()
				avgMap := map[string]float64{}
				for avgRows.Next() {
					var name string
					var avg float64
					if err := avgRows.Scan(&name, &avg); err == nil {
						avgMap[name] = avg
					}
				}
				avgRows.Close()

				// Find categories with significant increase (>10%)
				var increases []catTrend
				for name, current := range currentMap {
					avg, exists := avgMap[name]
					if !exists || avg <= 0 {
						continue
					}
					change := ((current - avg) / avg) * 100
					if change > 10 {
						increases = append(increases, catTrend{
							Name:         name,
							CurrentMonth: current,
							AvgPrev3:     avg,
							ChangePercent: change,
						})
					}
				}

				// Sort by highest change first
				sort.Slice(increases, func(i, j int) bool {
					return increases[i].ChangePercent > increases[j].ChangePercent
				})

				if len(increases) > 0 {
					top := increases[0]
					desc := fmt.Sprintf("Kategori %s naik %.1f%% dari rata-rata 3 bulan (Rp %.0f vs rata-rata Rp %.0f)",
						top.Name, top.ChangePercent, top.CurrentMonth, top.AvgPrev3)

					cats := []dto.InsightDataCategory{}
					for _, inc := range increases {
						cats = append(cats, dto.InsightDataCategory{
							Name:   inc.Name,
							Amount: inc.CurrentMonth,
							Change: inc.ChangePercent,
						})
					}
					data := dto.InsightData{Categories: cats}
					rawData, _ := json.Marshal(data)

					ins := s.insertInsight(ctx, ownerID, month, "spending_increase",
						"📈 Kenaikan Pengeluaran Signifikan", desc, rawData, "negative", sortOrder)
					if ins != nil {
						generatedInsights = append(generatedInsights, *ins)
						sortOrder++
					}
				}
			}
		}
	}

	// ═══════════════════════════════════════════════════════
	// 3. SUBSCRIPTION CHANGE — bandingkan total biaya subscription
	// ═══════════════════════════════════════════════════════
	{
		// Current month active subscription cost
		var currentSubCost float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(
				CASE frequency
					WHEN 'yearly' THEN amount / 12
					WHEN 'weekly' THEN amount * 52 / 12
					ELSE amount
				END
			), 0)
			FROM subscriptions
			WHERE user_id = $1
			  AND is_active = true
			  AND deleted_at IS NULL
		`, ownerID).Scan(&currentSubCost)

		// Previous month total (we look at subscriptions active at that point)
		// For simplicity, query subscriptions that existed before the current month
		var prevSubCost float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(
				CASE frequency
					WHEN 'yearly' THEN amount / 12
					WHEN 'weekly' THEN amount * 52 / 12
					ELSE amount
				END
			), 0)
			FROM subscriptions
			WHERE user_id = $1
			  AND is_active = true
			  AND deleted_at IS NULL
			  AND created_at < $2
		`, ownerID, monthStart.Format("2006-01-02")).Scan(&prevSubCost)

		if currentSubCost > 0 {
			diff := currentSubCost - prevSubCost
			var title, desc, severity string

			if math.Abs(diff) < 1000 {
				title = "📱 Biaya Langganan Stabil"
				desc = fmt.Sprintf("Total biaya langganan bulan ini Rp %.0f/bulan.", currentSubCost)
				severity = "neutral"
			} else if diff > 0 {
				title = "📱 Biaya Langganan Naik"
				desc = fmt.Sprintf("Total biaya langganan naik Rp %.0f menjadi Rp %.0f/bulan.", diff, currentSubCost)
				severity = "negative"
			} else {
				title = "📱 Biaya Langganan Turun"
				desc = fmt.Sprintf("Total biaya langganan turun Rp %.0f menjadi Rp %.0f/bulan.", math.Abs(diff), currentSubCost)
				severity = "positive"
			}

			data := dto.InsightData{
				CurrentCost:  currentSubCost,
				PreviousCost: prevSubCost,
			}
			rawData, _ := json.Marshal(data)

			ins := s.insertInsight(ctx, ownerID, month, "subscription_change",
				title, desc, rawData, severity, sortOrder)
			if ins != nil {
				generatedInsights = append(generatedInsights, *ins)
				sortOrder++
			}
		}
	}

	// ═══════════════════════════════════════════════════════
	// 4. CASHFLOW RISK — deteksi spending spike per minggu
	// ═══════════════════════════════════════════════════════
	{
		type weeklySpend struct {
			Week   int
			Amount float64
		}

		weekRows, err := s.dbPool.Query(ctx, `
			SELECT
				CASE
					WHEN EXTRACT(DAY FROM date) <= 7  THEN 1
					WHEN EXTRACT(DAY FROM date) <= 14 THEN 2
					WHEN EXTRACT(DAY FROM date) <= 21 THEN 3
					ELSE 4
				END as week_num,
				SUM(amount) as total
			FROM transactions
			WHERE user_id = $1
			  AND type = 'expense'
			  AND status = 'confirmed'
			  AND deleted_at IS NULL
			  AND date >= $2 AND date <= $3
			GROUP BY week_num
			ORDER BY week_num
		`, ownerID, monthStart.Format("2006-01-02"), monthEnd.Format("2006-01-02"))

		if err == nil {
			defer weekRows.Close()
			weeks := []weeklySpend{}
			totalSpend := 0.0
			for weekRows.Next() {
				var ws weeklySpend
				if err := weekRows.Scan(&ws.Week, &ws.Amount); err == nil {
					weeks = append(weeks, ws)
					totalSpend += ws.Amount
				}
			}
			weekRows.Close()

			if len(weeks) > 0 {
				avgWeekly := totalSpend / float64(len(weeks))

				// Find spike week (>150% of average)
				spikeWeek := -1
				spikeAmount := 0.0
				cashflowData := []dto.InsightDataCashflow{}
				for _, w := range weeks {
					isSpike := w.Amount > avgWeekly*1.5 && w.Amount > 0
					if isSpike && w.Amount > spikeAmount {
						spikeWeek = w.Week
						spikeAmount = w.Amount
					}
					cashflowData = append(cashflowData, dto.InsightDataCashflow{
						Week:    fmt.Sprintf("Minggu ke-%d", w.Week),
						Amount:  w.Amount,
						IsSpike: isSpike,
					})
				}

				var title, desc, severity string
				if spikeWeek > 0 {
					title = "⚡ Pengeluaran Terbesar di Minggu ke-" + fmt.Sprintf("%d", spikeWeek)
					desc = fmt.Sprintf("Pengeluaran terbesar terjadi di minggu ke-%d sebesar Rp %.0f (%.0f%% di atas rata-rata mingguan).",
						spikeWeek, spikeAmount, ((spikeAmount/avgWeekly)-1)*100)
					severity = "negative"
				} else {
					title = "💚 Pengeluaran Terdistribusi Merata"
					desc = "Pengeluaran bulan ini terdistribusi merata per minggu. Tidak ada spending spike signifikan."
					severity = "positive"
				}

				data := dto.InsightData{Cashflow: cashflowData}
				rawData, _ := json.Marshal(data)

				ins := s.insertInsight(ctx, ownerID, month, "cashflow_risk",
					title, desc, rawData, severity, sortOrder)
				if ins != nil {
					generatedInsights = append(generatedInsights, *ins)
					sortOrder++
				}
			}
		}
	}

	// ═══════════════════════════════════════════════════════
	// 5. NETWORTH TREND — bandingkan net worth bulan ini vs bulan lalu
	// ═══════════════════════════════════════════════════════
	{
		// Current net worth: total assets - total debts
		var totalAssets, totalDebts float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(current_value), 0) FROM assets
			WHERE user_id = $1 AND deleted_at IS NULL
		`, ownerID).Scan(&totalAssets)

		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(balance), 0) FROM accounts
			WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL
		`, ownerID).Scan(&totalAssets) // override with account balance for accuracy

		// Re-fetch properly: assets + account balance
		var assetValue, accountBalance float64
		_ = s.dbPool.QueryRow(ctx, `SELECT COALESCE(SUM(current_value), 0) FROM assets WHERE user_id = $1 AND deleted_at IS NULL`, ownerID).Scan(&assetValue)
		_ = s.dbPool.QueryRow(ctx, `SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL`, ownerID).Scan(&accountBalance)
		totalAssets = assetValue + accountBalance

		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(outstanding_balance), 0) FROM debts
			WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
		`, ownerID).Scan(&totalDebts)

		currentNetWorth := totalAssets - totalDebts

		// Look for previous month's closing snapshot
		var prevNetWorth float64
		prevMonth := targetDate.AddDate(0, -1, 0).Format("2006-01")
		err := s.dbPool.QueryRow(ctx, `
			SELECT net_worth FROM monthly_closings WHERE user_id = $1 AND month = $2
		`, ownerID, prevMonth).Scan(&prevNetWorth)

		var title, desc, severity string
		if err != nil || prevNetWorth == 0 {
			// No previous closing data
			title = "💎 Net Worth Saat Ini"
			desc = fmt.Sprintf("Net worth saat ini sebesar Rp %.0f (Aset Rp %.0f - Utang Rp %.0f).",
				currentNetWorth, totalAssets, totalDebts)
			severity = "neutral"
		} else {
			change := currentNetWorth - prevNetWorth
			changePercent := (change / math.Abs(prevNetWorth)) * 100
			if change > 0 {
				title = "📈 Net Worth Meningkat"
				desc = fmt.Sprintf("Net worth naik %.1f%% dari Rp %.0f menjadi Rp %.0f bulan ini.",
					changePercent, prevNetWorth, currentNetWorth)
				severity = "positive"
			} else if change < 0 {
				title = "📉 Net Worth Menurun"
				desc = fmt.Sprintf("Net worth turun %.1f%% dari Rp %.0f menjadi Rp %.0f bulan ini.",
					math.Abs(changePercent), prevNetWorth, currentNetWorth)
				severity = "negative"
			} else {
				title = "💎 Net Worth Stabil"
				desc = fmt.Sprintf("Net worth tidak berubah di Rp %.0f bulan ini.", currentNetWorth)
				severity = "neutral"
			}
		}

		data := dto.InsightData{
			CurrentNetWorth:  currentNetWorth,
			PreviousNetWorth: prevNetWorth,
			ChangePercent:    func() float64 {
				if prevNetWorth == 0 { return 0 }
				return ((currentNetWorth - prevNetWorth) / math.Abs(prevNetWorth)) * 100
			}(),
		}
		rawData, _ := json.Marshal(data)

		ins := s.insertInsight(ctx, ownerID, month, "networth_trend",
			title, desc, rawData, severity, sortOrder)
		if ins != nil {
			generatedInsights = append(generatedInsights, *ins)
			sortOrder++
		}
	}

	// ═══════════════════════════════════════════════════════
	// 6. RECOMMENDATION — saran berdasarkan pola 3 bulan
	// ═══════════════════════════════════════════════════════
	{
		// Find categories over budget 3 months in a row
		overBudgetRows, err := s.dbPool.Query(ctx, `
			WITH monthly_spending AS (
				SELECT
					c.name as cat_name,
					TO_CHAR(t.date, 'YYYY-MM') as spend_month,
					SUM(t.amount) as spent
				FROM transactions t
				JOIN categories c ON t.category_id = c.id
				WHERE t.user_id = $1
				  AND t.type = 'expense'
				  AND t.status = 'confirmed'
				  AND t.deleted_at IS NULL
				  AND t.date >= $2 AND t.date < $3
				GROUP BY c.name, TO_CHAR(t.date, 'YYYY-MM')
			),
			budget_spending AS (
				SELECT
					c.name as cat_name,
					b.month,
					COALESCE(ms.spent, 0) as spent,
					b.amount as budget
				FROM budgets b
				JOIN categories c ON b.category_id = c.id
				LEFT JOIN monthly_spending ms ON ms.cat_name = c.name AND ms.spend_month = b.month
				WHERE b.user_id = $1
				  AND b.month >= TO_CHAR($2::date, 'YYYY-MM')
				  AND b.month < TO_CHAR($3::date, 'YYYY-MM')
			)
			SELECT cat_name, COUNT(*) as over_count
			FROM budget_spending
			WHERE spent > budget
			GROUP BY cat_name
			HAVING COUNT(*) >= 2
			ORDER BY over_count DESC
			LIMIT 3
		`, ownerID, threeMonthsAgo.Format("2006-01-02"), monthStart.Format("2006-01-02"))

		overBudgetCats := []string{}
		if err == nil {
			defer overBudgetRows.Close()
			for overBudgetRows.Next() {
				var catName string
				var cnt int
				if err := overBudgetRows.Scan(&catName, &cnt); err == nil {
					overBudgetCats = append(overBudgetCats, catName)
				}
			}
			overBudgetRows.Close()
		}

		// Look at total income vs expense ratio for this month
		var totalIncome, totalExpense float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0),
			       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)
			FROM transactions
			WHERE user_id = $1
			  AND status = 'confirmed'
			  AND deleted_at IS NULL
			  AND date >= $2 AND date <= $3
		`, ownerID, monthStart.Format("2006-01-02"), monthEnd.Format("2006-01-02")).Scan(&totalIncome, &totalExpense)

		var title, desc string
		if len(overBudgetCats) > 0 {
			title = "💡 Rekomendasi: Kurangi Pengeluaran Berulang"
			desc = fmt.Sprintf("Kategori %s telah melebihi budget 2+ bulan berturut-turut. Pertimbangkan untuk review dan revisi alokasi budget.",
				strings.Join(overBudgetCats, ", "))
		} else if totalIncome > 0 && totalExpense/totalIncome > 0.85 {
			title = "💡 Rekomendasi: Tingkatkan Tabungan"
			desc = fmt.Sprintf("Rasio pengeluaran terhadap pendapatan bulan ini %.0f%%. Pertimbangkan untuk meningkatkan persentase tabungan.",
				(totalExpense/totalIncome)*100)
		} else if totalIncome > 0 && totalExpense/totalIncome < 0.6 {
			title = "💡 Rekomendasi: Tinjau Alokasi Surplus"
			desc = "Pengeluaran terkendali. Tinjau apakah surplus lebih cocok untuk buffer, target, atau tujuan jangka panjang. Bukan rekomendasi produk investasi."
		} else {
			title = "💡 Keuangan Terkendali"
			desc = "Pola keuangan bulan ini terlihat seimbang. Tetap pantau pengeluaran dan pastikan target tabungan terpenuhi."
		}

		_ = oneMonthAgo // suppress unused variable

		severity := "neutral"
		if len(overBudgetCats) > 0 {
			severity = "negative"
		} else if totalIncome > 0 && totalExpense/totalIncome < 0.6 {
			severity = "positive"
		}

		data := dto.InsightData{OverBudgetCategories: overBudgetCats}
		rawData, _ := json.Marshal(data)

		ins := s.insertInsight(ctx, ownerID, month, "recommendation",
			title, desc, rawData, severity, sortOrder)
		if ins != nil {
			generatedInsights = append(generatedInsights, *ins)
		}
	}

	return &dto.InsightsListResponse{
		Month:    month,
		Insights: generatedInsights,
	}, nil
}

// insertInsight persists a single insight and returns the response DTO
func (s *insightService) insertInsight(
	ctx context.Context,
	ownerID, month, insightType, title, description string,
	rawData []byte,
	severity string,
	sortOrder int,
) *dto.MonthlyInsightResponse {
	var id string
	var createdAt time.Time

	err := s.dbPool.QueryRow(ctx, `
		INSERT INTO monthly_insights (user_id, month, insight_type, title, description, data, severity, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at
	`, ownerID, month, insightType, title, description, rawData, severity, sortOrder).Scan(&id, &createdAt)
	if err != nil {
		return nil
	}

	var insData dto.InsightData
	if rawData != nil {
		_ = json.Unmarshal(rawData, &insData)
	}

	return &dto.MonthlyInsightResponse{
		ID:          id,
		UserID:      ownerID,
		Month:       month,
		InsightType: insightType,
		Title:       title,
		Description: description,
		Data:        insData,
		Severity:    severity,
		SortOrder:   sortOrder,
		CreatedAt:   createdAt,
	}
}

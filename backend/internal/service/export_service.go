package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jung-kurt/gofpdf/v2"
	"github.com/user/financial-os/internal/dto"
)

type ExportService interface {
	ExportTransactionsCSV(ctx context.Context, userID string, dateFrom, dateTo, accountID string) ([]byte, error)
	ExportMonthlyClosingPDF(ctx context.Context, userID string, month string) ([]byte, error)
}

type exportService struct {
	dbPool *pgxpool.Pool
}

func NewExportService(dbPool *pgxpool.Pool) ExportService {
	return &exportService{dbPool: dbPool}
}

func (s *exportService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *exportService) ExportTransactionsCSV(ctx context.Context, userID string, dateFrom, dateTo, accountID string) ([]byte, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	query := `
		SELECT t.id, t.date, t.type, COALESCE(c.name, '') as category_name, 
		       a.name as account_name, t.amount, COALESCE(t.description, '') as description, t.is_split
		FROM transactions t
		LEFT JOIN categories c ON t.category_id = c.id
		LEFT JOIN accounts a ON t.account_id = a.id
		WHERE t.user_id = $1 AND t.deleted_at IS NULL
	`
	args := []interface{}{ownerID}
	argIdx := 2

	if dateFrom != "" {
		parsed, err := time.Parse("2006-01-02", dateFrom)
		if err == nil {
			query += fmt.Sprintf(" AND t.date >= $%d", argIdx)
			args = append(args, parsed)
			argIdx++
		}
	}

	if dateTo != "" {
		parsed, err := time.Parse("2006-01-02", dateTo)
		if err == nil {
			query += fmt.Sprintf(" AND t.date <= $%d", argIdx)
			args = append(args, parsed)
			argIdx++
		}
	}

	if accountID != "" {
		query += fmt.Sprintf(" AND t.account_id = $%d", argIdx)
		args = append(args, accountID)
		argIdx++
	}

	query += " ORDER BY t.date DESC, t.created_at DESC"

	rows, err := s.dbPool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query transactions for export: %w", err)
	}
	defer rows.Close()

	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)

	// Write CSV Header
	header := []string{"Tanggal", "Tipe", "Kategori", "Rekening", "Jumlah", "Keterangan"}
	if err := writer.Write(header); err != nil {
		return nil, err
	}

	for rows.Next() {
		var txID string
		var date valDate
		var txType, catName, accName, description string
		var amount float64
		var isSplit bool

		type valDate time.Time
		err = rows.Scan(&txID, &date, &txType, &catName, &accName, &amount, &description, &isSplit)
		if err != nil {
			return nil, err
		}

		dateStr := time.Time(date).Format("2006-01-02")
		amountStr := strconv.FormatFloat(amount, 'f', 2, 64)

		typeLabels := map[string]string{
			"income":   "Pemasukan",
			"expense":  "Pengeluaran",
			"transfer": "Transfer",
		}
		typeLabel := typeLabels[txType]
		if typeLabel == "" {
			typeLabel = txType
		}

		if isSplit {
			// Fetch splits
			splitRows, err := s.dbPool.Query(ctx, `
				SELECT ts.amount, ts.description, c.name
				FROM transaction_splits ts
				JOIN categories c ON ts.category_id = c.id
				WHERE ts.transaction_id = $1
			`, txID)
			if err == nil {
				hasSplits := false
				for splitRows.Next() {
					hasSplits = true
					var splitAmt float64
					var splitDesc string
					var splitCat string
					if err := splitRows.Scan(&splitAmt, &splitDesc, &splitCat); err == nil {
						desc := description
						if splitDesc != "" {
							desc = fmt.Sprintf("%s (%s)", description, splitDesc)
						}
						row := []string{
							dateStr,
							typeLabel,
							splitCat,
							accName,
							strconv.FormatFloat(splitAmt, 'f', 2, 64),
							desc,
						}
						_ = writer.Write(row)
					}
				}
				splitRows.Close()
				if hasSplits {
					continue
				}
			}
		}

		row := []string{
			dateStr,
			typeLabel,
			catName,
			accName,
			amountStr,
			description,
		}
		if err := writer.Write(row); err != nil {
			return nil, err
		}
	}

	writer.Flush()
	return buf.Bytes(), nil
}

type valDate time.Time

func (d *valDate) Scan(value interface{}) error {
	if value == nil {
		*d = valDate(time.Time{})
		return nil
	}
	t, ok := value.(time.Time)
	if !ok {
		return fmt.Errorf("invalid time type")
	}
	*d = valDate(t)
	return nil
}

func (s *exportService) ExportMonthlyClosingPDF(ctx context.Context, userID string, month string) ([]byte, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var snapshotBytes []byte
	var notes string
	var confirmedAt *time.Time

	err = s.dbPool.QueryRow(ctx, `
		SELECT snapshot, COALESCE(notes, ''), confirmed_at
		FROM monthly_closings
		WHERE user_id = $1 AND month = $2
	`, ownerID, month).Scan(&snapshotBytes, &notes, &confirmedAt)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("monthly closing report not found for this month")
		}
		return nil, err
	}

	var snapshot dto.ClosingSnapshot
	err = json.Unmarshal(snapshotBytes, &snapshot)
	if err != nil {
		return nil, fmt.Errorf("failed to parse snapshot data: %w", err)
	}

	// 1. Generate PDF via gofpdf
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(15, 15, 15)
	pdf.AddPage()

	// Color definitions (Harmonious sleek design)
	darkSlate := []int{30, 41, 59}
	indigoColor := []int{79, 70, 229}
	emeraldColor := []int{16, 185, 129}
	roseColor := []int{244, 63, 94}
	lightSlate := []int{248, 250, 252}

	// Header Banner
	pdf.SetFillColor(darkSlate[0], darkSlate[1], darkSlate[2])
	pdf.Rect(0, 0, 210, 45, "F")

	pdf.SetTextColor(255, 255, 255)
	pdf.SetFont("Arial", "B", 18)
	pdf.Text(15, 20, "LAPORAN KEUANGAN BULANAN")
	pdf.SetFont("Arial", "B", 14)
	pdf.Text(15, 28, fmt.Sprintf("Periode: %s", month))

	pdf.SetFont("Arial", "I", 9)
	pdf.Text(15, 36, fmt.Sprintf("Dikonfirmasi pada: %s", confirmedAt.Format("02 Jan 2006, 15:04")))

	// Content start y coord
	y := 55.0

	// helper function to draw section title
	drawSectionHeader := func(title string) {
		pdf.SetY(y)
		pdf.SetFont("Arial", "B", 11)
		pdf.SetTextColor(indigoColor[0], indigoColor[1], indigoColor[2])
		pdf.CellFormat(180, 8, title, "B", 0, "L", false, 0, "")
		y += 12
	}

	// format rupiah helper
	formatRupiah := func(val float64) string {
		parts := fmt.Sprintf("%.0f", val)
		// insert thousand dots
		var result []byte
		n := len(parts)
		for i := 0; i < n; i++ {
			if i > 0 && (n-i)%3 == 0 {
				result = append(result, '.')
			}
			result = append(result, parts[i])
		}
		return "Rp " + string(result)
	}

	// 2. Overview Metrics 4-grid layout representation
	drawSectionHeader("IKHTISAR KEUANGAN")

	pdf.SetFont("Arial", "", 9)
	pdf.SetTextColor(100, 116, 139)
	pdf.SetFillColor(lightSlate[0], lightSlate[1], lightSlate[2])

	// Net Worth & Cash Row
	pdf.SetY(y)
	pdf.Rect(15, y, 85, 16, "DF")
	pdf.Rect(110, y, 85, 16, "DF")

	pdf.SetTextColor(100, 116, 139)
	pdf.SetFont("Arial", "", 8)
	pdf.Text(18, y+5, "KEKAYAAN BERSIH (NET WORTH)")
	pdf.Text(113, y+5, "TOTAL KAS LIKUID")

	pdf.SetTextColor(darkSlate[0], darkSlate[1], darkSlate[2])
	pdf.SetFont("Arial", "B", 11)
	pdf.Text(18, y+12, formatRupiah(snapshot.NetWorth))
	pdf.Text(113, y+12, formatRupiah(snapshot.TotalCash))
	y += 20

	// Assets & Debts Row
	pdf.SetY(y)
	pdf.Rect(15, y, 85, 16, "DF")
	pdf.Rect(110, y, 85, 16, "DF")

	pdf.SetTextColor(100, 116, 139)
	pdf.SetFont("Arial", "", 8)
	pdf.Text(18, y+5, "TOTAL ASET")
	pdf.Text(113, y+5, "TOTAL UTANG / LIABILITAS")

	pdf.SetTextColor(emeraldColor[0], emeraldColor[1], emeraldColor[2])
	pdf.SetFont("Arial", "B", 11)
	pdf.Text(18, y+12, formatRupiah(snapshot.TotalAssets))
	pdf.SetTextColor(roseColor[0], roseColor[1], roseColor[2])
	pdf.Text(113, y+12, formatRupiah(snapshot.TotalDebts))
	y += 24

	// Income vs Expense Table
	drawSectionHeader("PENDAPATAN VS PENGELUARAN")
	pdf.SetY(y)
	pdf.SetFont("Arial", "", 9)
	pdf.SetTextColor(100, 116, 139)
	pdf.CellFormat(60, 8, "Kategori Aliran Dana", "1", 0, "L", false, 0, "")
	pdf.CellFormat(60, 8, "Nominal", "1", 0, "R", false, 0, "")
	pdf.CellFormat(60, 8, "Persentase Pemakaian", "1", 1, "R", false, 0, "")
	y += 8

	pdf.SetTextColor(darkSlate[0], darkSlate[1], darkSlate[2])
	pdf.CellFormat(60, 8, "  Total Pendapatan (Income)", "1", 0, "L", false, 0, "")
	pdf.CellFormat(60, 8, formatRupiah(snapshot.TotalIncome), "1", 0, "R", false, 0, "")
	pdf.CellFormat(60, 8, "100%", "1", 1, "R", false, 0, "")
	y += 8

	spentPct := 0.0
	if snapshot.TotalIncome > 0 {
		spentPct = (snapshot.TotalExpense / snapshot.TotalIncome) * 100
	}
	pdf.CellFormat(60, 8, "  Total Pengeluaran (Expense)", "1", 0, "L", false, 0, "")
	pdf.CellFormat(60, 8, formatRupiah(snapshot.TotalExpense), "1", 0, "R", false, 0, "")
	pdf.CellFormat(60, 8, fmt.Sprintf("%.1f%%", spentPct), "1", 1, "R", false, 0, "")
	y += 14

	// Health score check
	pdf.SetY(y)
	pdf.SetFont("Arial", "B", 10)
	pdf.SetTextColor(darkSlate[0], darkSlate[1], darkSlate[2])
	pdf.CellFormat(180, 8, fmt.Sprintf("Health Score Bulan Ini: %d/100 | DTI Ratio: %.1f%% | EF Coverage: %.1f Bulan", snapshot.HealthScore, snapshot.DTIRatio, snapshot.EFCoverageMonths), "1", 1, "C", true, 0, "")
	y += 14

	// Rincian Akun & Saldo
	drawSectionHeader("SALDO REKENING KEUANGAN")
	pdf.SetY(y)
	pdf.SetFont("Arial", "B", 8)
	pdf.SetTextColor(255, 255, 255)
	pdf.SetFillColor(indigoColor[0], indigoColor[1], indigoColor[2])
	pdf.CellFormat(100, 6, "Nama Rekening", "1", 0, "L", true, 0, "")
	pdf.CellFormat(80, 6, "Saldo Akhir", "1", 1, "R", true, 0, "")
	y += 6

	pdf.SetFont("Arial", "", 8)
	pdf.SetTextColor(darkSlate[0], darkSlate[1], darkSlate[2])
	for _, acc := range snapshot.Accounts {
		pdf.CellFormat(100, 6, "  "+acc.Name, "1", 0, "L", false, 0, "")
		pdf.CellFormat(80, 6, formatRupiah(acc.Balance), "1", 1, "R", false, 0, "")
		y += 6
	}
	y += 10

	// Check page overflow
	if y > 240 {
		pdf.AddPage()
		y = 20
	}

	// Anggaran Kategori (Budgets)
	drawSectionHeader("REALISASI ANGGARAN KATEGORI")
	pdf.SetY(y)
	pdf.SetFont("Arial", "B", 8)
	pdf.SetTextColor(255, 255, 255)
	pdf.SetFillColor(indigoColor[0], indigoColor[1], indigoColor[2])
	pdf.CellFormat(70, 6, "Nama Kategori", "1", 0, "L", true, 0, "")
	pdf.CellFormat(55, 6, "Limit Anggaran", "1", 0, "R", true, 0, "")
	pdf.CellFormat(55, 6, "Realisasi Pengeluaran", "1", 1, "R", true, 0, "")
	y += 6

	pdf.SetFont("Arial", "", 8)
	pdf.SetTextColor(darkSlate[0], darkSlate[1], darkSlate[2])
	for _, c := range snapshot.BudgetSummary.Categories {
		pdf.CellFormat(70, 6, "  "+c.Name, "1", 0, "L", false, 0, "")
		pdf.CellFormat(55, 6, formatRupiah(c.Budget), "1", 0, "R", false, 0, "")
		
		if c.Actual > c.Budget {
			pdf.SetTextColor(roseColor[0], roseColor[1], roseColor[2])
		}
		pdf.CellFormat(55, 6, formatRupiah(c.Actual), "1", 1, "R", false, 0, "")
		pdf.SetTextColor(darkSlate[0], darkSlate[1], darkSlate[2])
		y += 6
	}
	y += 10

	// Check page overflow again
	if y > 240 {
		pdf.AddPage()
		y = 20
	}

	// Goals Progress
	if len(snapshot.GoalsProgress) > 0 {
		drawSectionHeader("PROGRESS GOALS KEUANGAN")
		pdf.SetY(y)
		pdf.SetFont("Arial", "B", 8)
		pdf.SetTextColor(255, 255, 255)
		pdf.SetFillColor(indigoColor[0], indigoColor[1], indigoColor[2])
		pdf.CellFormat(100, 6, "Nama Goal", "1", 0, "L", true, 0, "")
		pdf.CellFormat(80, 6, "Persentase Capaian", "1", 1, "R", true, 0, "")
		y += 6

		pdf.SetFont("Arial", "", 8)
		pdf.SetTextColor(darkSlate[0], darkSlate[1], darkSlate[2])
		for _, g := range snapshot.GoalsProgress {
			pdf.CellFormat(100, 6, "  "+g.Name, "1", 0, "L", false, 0, "")
			pdf.CellFormat(80, 6, fmt.Sprintf("%.1f%%", g.Progress), "1", 1, "R", false, 0, "")
			y += 6
		}
		y += 10
	}

	// Catatan Tutup Buku
	if notes != "" {
		if y > 240 {
			pdf.AddPage()
			y = 20
		}
		drawSectionHeader("CATATAN EVALUASI")
		pdf.SetY(y)
		pdf.SetFont("Arial", "I", 9)
		pdf.MultiCell(180, 6, notes, "1", "L", false)
	}

	var buf bytes.Buffer
	err = pdf.Output(&buf)
	if err != nil {
		return nil, fmt.Errorf("failed to generate PDF output: %w", err)
	}

	return buf.Bytes(), nil
}

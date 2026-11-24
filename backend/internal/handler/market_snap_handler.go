package handler

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/user/financial-os/internal/connector"
	"github.com/user/financial-os/internal/middleware"
)

type MarketPricesPayload struct {
	GoldAntamPerGramIDR int64              `json:"gold_antam_per_gram_idr"`
	USDIDR              int64              `json:"usd_idr"`
	SGDIDR              int64              `json:"sgd_idr"`
	SBNCouponPct        float64            `json:"sbn_coupon_pct"`
	IDXPrices           map[string]float64 `json:"idx_prices"`
	UpdatedAt           string             `json:"updated_at"`
	Source              string             `json:"source"`
}

func defaultMarketPrices() MarketPricesPayload {
	return MarketPricesPayload{
		GoldAntamPerGramIDR: 1585000,
		USDIDR:              15850,
		SGDIDR:              11820,
		SBNCouponPct:        6.4,
		IDXPrices: map[string]float64{
			"BBCA": 10250,
			"BMRI": 6850,
			"BBRI": 4950,
			"TLKM": 3150,
			"ASII": 5100,
			"BBNI": 5300,
			"ICBP": 11600,
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Source:    "benchmark",
	}
}

type MarketSnapHandler struct {
	mu           sync.RWMutex
	cachedPrices *MarketPricesPayload
	cachedAt     time.Time
	httpClient   *http.Client
	disableLive  bool
	txImporter   InboundTransactionCreator
}

func NewMarketSnapHandler() *MarketSnapHandler {
	return &MarketSnapHandler{
		httpClient: &http.Client{Timeout: 2500 * time.Millisecond},
	}
}

func (h *MarketSnapHandler) WithImporter(importer InboundTransactionCreator) *MarketSnapHandler {
	h.txImporter = importer
	return h
}

func (h *MarketSnapHandler) RegisterRoutes(rg *gin.RouterGroup) {
	mkt := rg.Group("/market")
	mkt.Use(middleware.AuthMiddleware())
	{
		mkt.GET("/prices", h.GetPrices)
	}

	snap := rg.Group("/connectors/snap-bi")
	snap.Use(middleware.AuthMiddleware())
	{
		snap.GET("/status", h.GetSNAPStatus)
		snap.POST("/sync", middleware.RoleMiddleware("owner"), h.SyncSNAPSandbox)
	}
}

func (h *MarketSnapHandler) fetchYahooClose(ctx context.Context, symbol string) (float64, bool) {
	url := "https://query1.finance.yahoo.com/v8/finance/chart/" + symbol + "?range=1d&interval=1d"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, false
	}
	req.Header.Set("User-Agent", "KeuanganBersama/1.0")
	resp, err := h.httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		return 0, false
	}
	defer resp.Body.Close()

	var payload struct {
		Chart struct {
			Result []struct {
				Meta struct {
					RegularMarketPrice float64 `json:"regularMarketPrice"`
				} `json:"meta"`
			} `json:"result"`
		} `json:"chart"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return 0, false
	}
	if len(payload.Chart.Result) == 0 || payload.Chart.Result[0].Meta.RegularMarketPrice <= 0 {
		return 0, false
	}
	return payload.Chart.Result[0].Meta.RegularMarketPrice, true
}

func (h *MarketSnapHandler) fetchPricesFromUpstreams(ctx context.Context) MarketPricesPayload {
	out := defaultMarketPrices()
	if h.disableLive || h.httpClient == nil {
		return out
	}

	liveAny := false

	// 1. Live FX USD/IDR & SGD/IDR
	if req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://open.er-api.com/v6/latest/USD", nil); err == nil {
		if resp, err := h.httpClient.Do(req); err == nil {
			if resp.StatusCode == http.StatusOK {
				var fx struct {
					Rates map[string]float64 `json:"rates"`
				}
				if json.NewDecoder(resp.Body).Decode(&fx) == nil {
					if idr := fx.Rates["IDR"]; idr > 1000 {
						out.USDIDR = int64(math.Round(idr))
						liveAny = true
						if sgd := fx.Rates["SGD"]; sgd > 0 {
							out.SGDIDR = int64(math.Round(idr / sgd))
						}
					}
				}
			}
			resp.Body.Close()
		}
	}

	// 2. Live Gold spot (GC=F) -> IDR/gram estimate (1 troy oz = 31.1034768g)
	if goldUSDPerOz, ok := h.fetchYahooClose(ctx, "GC=F"); ok && goldUSDPerOz > 500 {
		idrPerGram := (goldUSDPerOz / 31.1034768) * float64(out.USDIDR) * 1.08
		out.GoldAntamPerGramIDR = int64(math.Round(idrPerGram/1000) * 1000)
		liveAny = true
	}

	// 3. Top IDX Tickers
	for ticker := range out.IDXPrices {
		if px, ok := h.fetchYahooClose(ctx, ticker+".JK"); ok {
			out.IDXPrices[ticker] = math.Round(px)
			liveAny = true
		}
	}

	if liveAny {
		out.Source = "live"
	}
	out.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return out
}

func (h *MarketSnapHandler) GetPrices(c *gin.Context) {
	forceRefresh := strings.EqualFold(c.Query("refresh"), "true")

	h.mu.RLock()
	if !forceRefresh && h.cachedPrices != nil && time.Since(h.cachedAt) < 15*time.Minute {
		cp := *h.cachedPrices
		h.mu.RUnlock()
		c.JSON(http.StatusOK, gin.H{"data": cp})
		return
	}
	h.mu.RUnlock()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()
	fresh := h.fetchPricesFromUpstreams(ctx)

	h.mu.Lock()
	h.cachedPrices = &fresh
	h.cachedAt = time.Now()
	h.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{"data": fresh})
}

func (h *MarketSnapHandler) GetSNAPStatus(c *gin.Context) {
	clientID := strings.TrimSpace(os.Getenv("SNAP_BI_CLIENT_ID"))
	mode := "sandbox"
	if clientID != "" && strings.TrimSpace(os.Getenv("SNAP_BI_CLIENT_SECRET")) != "" {
		mode = "configured"
	}
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"mode":                mode,
			"provider":            "SNAP-BI-Sandbox",
			"signature_algorithm": "HMAC-SHA512",
			"supported_channels":  []string{"QRIS Tap", "QRIS", "BI-FAST", "TRANSFER"},
			"as_of":               connector.FormatSNAPTimestamp(time.Now()),
		},
	})
}

func (h *MarketSnapHandler) SyncSNAPSandbox(c *gin.Context) {
	ownerID := c.GetString("user_id")
	var req struct {
		BankName     string `json:"bank_name"`
		AccountNo    string `json:"account_no"`
		ImportDrafts bool   `json:"import_drafts"`
	}
	_ = c.ShouldBindJSON(&req)

	provider := strings.TrimSpace(req.BankName)
	if provider == "" {
		provider = "SNAP-BI-Sandbox"
	}
	acctNo := strings.TrimSpace(req.AccountNo)
	if acctNo == "" {
		acctNo = "1234567890"
	}

	clientID := os.Getenv("SNAP_BI_CLIENT_ID")
	if clientID == "" {
		clientID = "sandbox-client-id"
	}
	clientSecret := os.Getenv("SNAP_BI_CLIENT_SECRET")
	if clientSecret == "" {
		clientSecret = "sandbox-client-secret"
	}

	conn := connector.NewSandboxSNAPConnector(provider, clientID, clientSecret)
	ctx := c.Request.Context()
	token, err := conn.GetAccessToken(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"code": "SNAP_AUTH_FAILED", "message": err.Error()}})
		return
	}
	bal, err := conn.GetAccountBalance(ctx, token, acctNo)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"code": "SNAP_BALANCE_FAILED", "message": err.Error()}})
		return
	}
	items, err := conn.GetTransactionHistory(ctx, token, acctNo, time.Now().Add(-7*24*time.Hour), time.Now())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"code": "SNAP_HISTORY_FAILED", "message": err.Error()}})
		return
	}

	importedCount := 0
	if req.ImportDrafts && h.txImporter != nil {
		for _, it := range items {
			txType := "expense"
			if it.Direction == "CR" {
				txType = "income"
			}
			dateStr := time.Now().Format("2006-01-02")
			if len(it.OccurredAt) >= 10 {
				dateStr = it.OccurredAt[:10]
			}
			if _, impErr := h.txImporter(ctx, ownerID, it.Amount, txType, it.Description+" ("+it.Channel+")", provider, dateStr, "pdf_parse"); impErr == nil {
				importedCount++
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"provider":       conn.ProviderName(),
			"balance":        bal,
			"transactions":   items,
			"imported_count": importedCount,
			"synced_at":      connector.FormatSNAPTimestamp(time.Now()),
		},
	})
}

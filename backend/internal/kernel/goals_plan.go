package kernel

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// GoalsPlanVersion versions household goal priority + conflict planning.
const GoalsPlanVersion = "goals-v1"

// Goal plan feasibility statuses (aligned with service-level labels).
const (
	GoalStatusOnTrack    = "on_track"
	GoalStatusAtRisk     = "at_risk"
	GoalStatusOffTrack   = "off_track"
	GoalStatusAchieved   = "achieved"
	GoalStatusNoDeadline = "no_deadline"
	GoalStatusUnknown    = "unknown"
)

// GoalPlanItem is one active goal snapshot (pure input).
type GoalPlanItem struct {
	ID                         string
	Name                       string
	Type                       string // emergency_fund | debt_payoff | sinking_fund | custom | ...
	TargetAmount               float64
	CurrentAmount              float64
	TargetDate                 *time.Time
	AverageMonthlyContribution float64
	// PriorityOverride: if > 0, wins over type default.
	PriorityOverride int
}

// GoalPlanInputs drives ComputeGoalPlan. Pure — no I/O.
type GoalPlanInputs struct {
	AsOf time.Time

	// MonthlySurplus is estimated free cash after living costs (before goal funding).
	MonthlySurplus float64

	// Already reserved higher in the allocation hierarchy (EF top-up + high-interest debt).
	// Available for goals = max(0, MonthlySurplus - ReservedForEF - ReservedForDebt).
	ReservedForEF   float64
	ReservedForDebt float64

	Goals []GoalPlanItem
}

// GoalPlanItemResult is the planned funding share for one goal.
type GoalPlanItemResult struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	Type              string  `json:"type"`
	Priority          int     `json:"priority"`
	Remaining         float64 `json:"remaining"`
	MonthsRemaining   float64 `json:"months_remaining,omitempty"`
	MonthlyRequired   float64 `json:"monthly_required"`
	AllocatedMonthly  float64 `json:"allocated_monthly"`
	FundingShare      float64 `json:"funding_share"` // 0–1 of available pool
	FeasibilityStatus string  `json:"feasibility_status"`
	DelayMonths       float64 `json:"delay_months"` // extra months if underfunded at allocated pace
	IsAffordable      bool    `json:"is_affordable"`
	FundingGap        float64 `json:"funding_gap"` // monthly shortfall vs required
	Note              string  `json:"note"`
}

// GoalPlanConflict surfaces competing goals that cannot all be funded on time.
type GoalPlanConflict struct {
	Kind     string   `json:"kind"` // surplus_contention | deadline_cluster | priority_tradeoff
	GoalIDs  []string `json:"goal_ids"`
	GoalNames []string `json:"goal_names"`
	Message  string   `json:"message"`
	TradeOff string   `json:"trade_off"`
}

// GoalPlanResult is the pure household goal plan.
type GoalPlanResult struct {
	AsOf           time.Time `json:"as_of"`
	FormulaVersion string    `json:"formula_version"`

	MonthlySurplus      float64 `json:"monthly_surplus"`
	ReservedHigher      float64 `json:"reserved_higher_priority"`
	AvailableForGoals   float64 `json:"available_for_goals"`
	TotalMonthlyRequired float64 `json:"total_monthly_required"`
	TotalAllocated      float64 `json:"total_allocated"`
	UnfundedGap         float64 `json:"unfunded_gap"` // max(0, required − allocated)

	Items     []GoalPlanItemResult `json:"items"`
	Conflicts []GoalPlanConflict   `json:"conflicts"`
	TradeOffs []string             `json:"trade_offs"`
	Assumptions []string           `json:"assumptions"`
}

// GoalTypePriority maps goal type → hierarchy rank (1 = highest).
func GoalTypePriority(goalType string) int {
	switch goalType {
	case "emergency_fund":
		return 1
	case "debt_payoff":
		return 2
	case "sinking_fund":
		return 3
	default:
		return 5
	}
}

// ComputeGoalPlan allocates available surplus across goals by priority,
// detects conflicts when concurrent monthly needs exceed the pool, and
// estimates delay when underfunded. Pure function.
func ComputeGoalPlan(in GoalPlanInputs) GoalPlanResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	reserved := math.Max(0, in.ReservedForEF) + math.Max(0, in.ReservedForDebt)
	available := math.Max(0, in.MonthlySurplus) - reserved
	if available < 0 {
		available = 0
	}
	available = RoundMoney(available, 2)

	assumptions := []string{
		"Formula version " + GoalsPlanVersion,
		"Available for goals = max(0, monthly_surplus − reserved_EF − reserved_high_interest_debt)",
		"Allocation order: priority asc, then earliest target_date, then largest monthly need",
		"Within same priority, surplus is shared proportional to monthly_required",
		"Delay months = remaining/allocated − months_remaining when underfunded (0 if on pace)",
		"Educational plan only — not a product recommendation",
	}

	type workItem struct {
		item     GoalPlanItem
		priority int
		remaining float64
		months   float64
		monthly  float64
		achieved bool
		noDate   bool
	}

	var work []workItem
	for _, g := range in.Goals {
		w := workItem{item: g, priority: g.PriorityOverride}
		if w.priority <= 0 {
			w.priority = GoalTypePriority(g.Type)
		}
		w.remaining = RoundMoney(math.Max(0, g.TargetAmount-g.CurrentAmount), 2)
		if w.remaining <= 0 || g.CurrentAmount >= g.TargetAmount {
			w.achieved = true
			w.monthly = 0
			work = append(work, w)
			continue
		}
		if g.TargetDate == nil || g.TargetDate.IsZero() {
			w.noDate = true
			// Open-ended: treat as optional; monthly required = 0 for contention
			// but surface average contribution need as soft target of remaining/12.
			w.months = 12
			w.monthly = RoundMoney(w.remaining/12, 2)
			work = append(work, w)
			continue
		}
		months := g.TargetDate.Sub(asOf).Hours() / 24 / 30
		if months <= 0 {
			// Past deadline: entire remaining is immediate monthly need
			w.months = 0
			w.monthly = w.remaining
		} else {
			w.months = months
			w.monthly = RoundMoney(w.remaining/months, 2)
		}
		work = append(work, w)
	}

	// Sort for allocation: priority, then earliest deadline, then largest need
	sort.SliceStable(work, func(i, j int) bool {
		if work[i].priority != work[j].priority {
			return work[i].priority < work[j].priority
		}
		// achieved last
		if work[i].achieved != work[j].achieved {
			return !work[i].achieved && work[j].achieved
		}
		// no-date after dated
		if work[i].noDate != work[j].noDate {
			return !work[i].noDate && work[j].noDate
		}
		if !work[i].noDate && !work[j].noDate && work[i].item.TargetDate != nil && work[j].item.TargetDate != nil {
			if !work[i].item.TargetDate.Equal(*work[j].item.TargetDate) {
				return work[i].item.TargetDate.Before(*work[j].item.TargetDate)
			}
		}
		return work[i].monthly > work[j].monthly
	})

	// Total required for non-achieved dated goals (contention uses dated + past-due)
	var totalRequired float64
	for _, w := range work {
		if w.achieved {
			continue
		}
		if w.noDate {
			continue // soft — not counted in hard contention
		}
		totalRequired += w.monthly
	}
	totalRequired = RoundMoney(totalRequired, 2)

	// Allocate by priority groups: within a group, proportional to monthly need
	remainingPool := available
	allocated := make(map[string]float64, len(work))

	// Group indices by priority
	groups := make([][]int, 0)
	if len(work) > 0 {
		cur := []int{0}
		for i := 1; i < len(work); i++ {
			if work[i].priority == work[cur[0]].priority {
				cur = append(cur, i)
			} else {
				groups = append(groups, cur)
				cur = []int{i}
			}
		}
		groups = append(groups, cur)
	}

	for _, idxs := range groups {
		var groupNeed float64
		active := make([]int, 0, len(idxs))
		for _, i := range idxs {
			if work[i].achieved || work[i].noDate {
				allocated[work[i].item.ID] = 0
				continue
			}
			if work[i].monthly <= 0 {
				allocated[work[i].item.ID] = 0
				continue
			}
			active = append(active, i)
			groupNeed += work[i].monthly
		}
		if len(active) == 0 || remainingPool <= 0 || groupNeed <= 0 {
			for _, i := range active {
				allocated[work[i].item.ID] = 0
			}
			continue
		}
		if remainingPool >= groupNeed {
			for _, i := range active {
				allocated[work[i].item.ID] = work[i].monthly
				remainingPool = RoundMoney(remainingPool-work[i].monthly, 2)
			}
		} else {
			// Proportional share of remaining pool
			pool := remainingPool
			var used float64
			for j, i := range active {
				var share float64
				if j == len(active)-1 {
					share = RoundMoney(pool-used, 2) // last gets residual to avoid drift
				} else {
					share = RoundMoney(pool*(work[i].monthly/groupNeed), 2)
					used += share
				}
				allocated[work[i].item.ID] = share
			}
			remainingPool = 0
		}
	}

	// Soft allocation for no-date goals from leftover
	for i := range work {
		if !work[i].noDate || work[i].achieved {
			continue
		}
		if remainingPool <= 0 {
			allocated[work[i].item.ID] = 0
			continue
		}
		// Cap soft goals at their soft monthly target
		share := math.Min(remainingPool, work[i].monthly)
		allocated[work[i].item.ID] = RoundMoney(share, 2)
		remainingPool = RoundMoney(remainingPool-share, 2)
	}

	items := make([]GoalPlanItemResult, 0, len(work))
	var totalAlloc float64
	for _, w := range work {
		alloc := RoundMoney(allocated[w.item.ID], 2)
		totalAlloc += alloc
		share := 0.0
		if available > 0 {
			share = alloc / available
		}

		res := GoalPlanItemResult{
			ID:               w.item.ID,
			Name:             w.item.Name,
			Type:             w.item.Type,
			Priority:         w.priority,
			Remaining:        w.remaining,
			MonthsRemaining:  math.Max(0, w.months),
			MonthlyRequired:  w.monthly,
			AllocatedMonthly: alloc,
			FundingShare:     share,
			IsAffordable:     alloc+1e-9 >= w.monthly || w.achieved || w.noDate,
			FundingGap:       RoundMoney(math.Max(0, w.monthly-alloc), 2),
		}

		switch {
		case w.achieved:
			res.FeasibilityStatus = GoalStatusAchieved
			res.Note = "Target sudah tercapai."
			res.IsAffordable = true
		case w.noDate:
			res.FeasibilityStatus = GoalStatusNoDeadline
			res.Note = "Tanpa tenggat; alokasi sisa surplus bersifat opsional."
		case w.months <= 0 && w.remaining > 0:
			res.FeasibilityStatus = GoalStatusOffTrack
			res.DelayMonths = 0
			if alloc > 0 {
				res.DelayMonths = RoundMoney(w.remaining/alloc, 2) // months to clear from now
			}
			res.Note = fmt.Sprintf("Tenggat lewat; sisa %s. Butuh pelunasan segera.", moneyLabel(w.remaining))
		case alloc+1e-9 >= w.monthly && w.monthly > 0:
			res.FeasibilityStatus = GoalStatusOnTrack
			res.Note = fmt.Sprintf("Alokasi %s/bulan mencukupi kebutuhan %s/bulan.", moneyLabel(alloc), moneyLabel(w.monthly))
		case alloc > 0 && w.monthly > 0:
			// Underfunded — estimate delay
			monthsAtAlloc := w.remaining / alloc
			delay := math.Max(0, monthsAtAlloc-w.months)
			res.DelayMonths = RoundMoney(delay, 2)
			ratio := alloc / w.monthly
			if ratio >= 0.7 {
				res.FeasibilityStatus = GoalStatusAtRisk
				res.Note = fmt.Sprintf("Underfunded %.0f%%; estimasi telat ~%.1f bulan.", ratio*100, delay)
			} else {
				res.FeasibilityStatus = GoalStatusOffTrack
				res.Note = fmt.Sprintf("Alokasi hanya %.0f%% kebutuhan; estimasi telat ~%.1f bulan.", ratio*100, delay)
			}
		case w.monthly > 0:
			res.FeasibilityStatus = GoalStatusOffTrack
			res.DelayMonths = 0 // infinite without funding — leave 0 + note
			res.Note = "Tidak ada alokasi surplus tersisa setelah prioritas lebih tinggi."
		default:
			res.FeasibilityStatus = GoalStatusUnknown
			res.Note = "Kebutuhan bulanan tidak terdefinisi."
		}

		items = append(items, res)
	}

	// Conflicts
	var conflicts []GoalPlanConflict
	var tradeOffs []string

	if totalRequired > available+1e-6 && totalRequired > 0 {
		// Collect underfunded dated goals
		ids, names := []string{}, []string{}
		for _, it := range items {
			if it.FeasibilityStatus == GoalStatusAchieved || it.FeasibilityStatus == GoalStatusNoDeadline {
				continue
			}
			if it.FundingGap > 0 {
				ids = append(ids, it.ID)
				names = append(names, it.Name)
			}
		}
		if len(ids) >= 1 {
			msg := fmt.Sprintf(
				"Kebutuhan tujuan ber-tenggat %s/bulan melebihi surplus tersedia %s/bulan (gap %s).",
				moneyLabel(totalRequired), moneyLabel(available), moneyLabel(totalRequired-available),
			)
			to := "Perpanjang tenggat, turunkan target, naikkan surplus, atau prioritaskan 1–2 tujuan saja."
			conflicts = append(conflicts, GoalPlanConflict{
				Kind:      "surplus_contention",
				GoalIDs:   ids,
				GoalNames: names,
				Message:   msg,
				TradeOff:  to,
			})
			tradeOffs = append(tradeOffs, to)
		}
	}

	// Deadline cluster: 2+ goals due within 3 months both needing funding
	near := make([]GoalPlanItemResult, 0)
	for _, it := range items {
		if it.MonthsRemaining > 0 && it.MonthsRemaining <= 3 && it.MonthlyRequired > 0 && it.FeasibilityStatus != GoalStatusAchieved {
			near = append(near, it)
		}
	}
	if len(near) >= 2 {
		ids, names := make([]string, 0, len(near)), make([]string, 0, len(near))
		for _, it := range near {
			ids = append(ids, it.ID)
			names = append(names, it.Name)
		}
		to := "Geser salah satu tenggat atau pecah target menjadi fase agar likuiditas tidak bentrok."
		conflicts = append(conflicts, GoalPlanConflict{
			Kind:      "deadline_cluster",
			GoalIDs:   ids,
			GoalNames: names,
			Message:   fmt.Sprintf("%d tujuan jatuh tempo dalam ≤3 bulan dan saling bersaing untuk surplus yang sama.", len(near)),
			TradeOff:  to,
		})
		tradeOffs = append(tradeOffs, to)
	}

	// Priority tradeoff note when lower-priority goals get zero while higher not fully funded
	higherUnfunded := false
	lowerStarved := false
	for _, it := range items {
		if it.Priority <= 2 && it.FundingGap > 0 {
			higherUnfunded = true
		}
		if it.Priority >= 3 && it.AllocatedMonthly == 0 && it.MonthlyRequired > 0 && it.FeasibilityStatus != GoalStatusAchieved {
			lowerStarved = true
		}
	}
	if higherUnfunded && lowerStarved {
		to := "Selesaikan EF/debt prioritas lebih dulu; tujuan sekunder tertunda sampai surplus longgar."
		conflicts = append(conflicts, GoalPlanConflict{
			Kind:     "priority_tradeoff",
			Message:  "Prioritas tinggi (EF/debt) masih underfunded sehingga tujuan sekunder belum mendapat alokasi.",
			TradeOff: to,
		})
		tradeOffs = append(tradeOffs, to)
	}

	if len(tradeOffs) == 0 && available > 0 {
		tradeOffs = append(tradeOffs, "Surplus mencukupi kebutuhan tujuan ber-tenggat pada laju saat ini.")
	}

	return GoalPlanResult{
		AsOf:                 asOf,
		FormulaVersion:       GoalsPlanVersion,
		MonthlySurplus:       RoundMoney(math.Max(0, in.MonthlySurplus), 2),
		ReservedHigher:       RoundMoney(reserved, 2),
		AvailableForGoals:    available,
		TotalMonthlyRequired: totalRequired,
		TotalAllocated:       RoundMoney(totalAlloc, 2),
		UnfundedGap:          RoundMoney(math.Max(0, totalRequired-totalAlloc), 2),
		Items:                items,
		Conflicts:            conflicts,
		TradeOffs:            tradeOffs,
		Assumptions:          assumptions,
	}
}

func moneyLabel(v float64) string {
	return fmt.Sprintf("%.0f", math.Round(v))
}

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
	"github.com/user/financial-os/internal/kernel"
)

// JobRunner coordinates background jobs with Redis distributed locks + idempotency.
type JobRunner struct {
	rdb      *redis.Client
	ownerID  string
	ttl      time.Duration
}

func NewJobRunner(rdb *redis.Client, ownerID string) *JobRunner {
	if ownerID == "" {
		host, _ := os.Hostname()
		ownerID = fmt.Sprintf("%s-%d", host, os.Getpid())
	}
	return &JobRunner{rdb: rdb, ownerID: ownerID, ttl: 5 * time.Minute}
}

func (j *JobRunner) lockKey(jobName string) string {
	return "joblock:" + jobName
}

// Run tries to acquire a distributed lock then executes fn. Returns whether work ran.
func (j *JobRunner) Run(ctx context.Context, jobName, idempotencyKey string, fn func(context.Context) error) (ran bool, err error) {
	start := time.Now()
	attempt := 1
	decision, existing, err := j.tryLock(ctx, jobName, idempotencyKey)
	if err != nil {
		j.logRun(jobName, idempotencyKey, "failure", attempt, start, "lock_error")
		return false, err
	}
	if !decision.Acquired {
		outcome := "skipped_lock"
		if decision.Reason == "idempotent_skip" {
			outcome = "skipped_idempotent"
		}
		j.logRun(jobName, idempotencyKey, outcome, attempt, start, decision.Reason)
		_ = existing
		return false, nil
	}
	// Ensure lock key is set with TTL even if Redis race — SET NX already done in tryLock
	defer func() {
		// best-effort: leave key until TTL; optional release if we still own it
		_ = j.releaseIfOwner(ctx, jobName)
	}()

	retry := kernel.DefaultJobRetry()
	var lastErr error
	for attempt = 1; attempt <= retry.MaxAttempts; attempt++ {
		lastErr = fn(ctx)
		if lastErr == nil {
			j.logRun(jobName, idempotencyKey, "success", attempt, start, "")
			return true, nil
		}
		delay := kernel.NextRetryDelay(retry, attempt)
		if delay == 0 {
			break
		}
		log.Warn().Err(lastErr).Str("job", jobName).Int("attempt", attempt).Dur("delay", delay).Msg("job retry")
		select {
		case <-ctx.Done():
			j.logRun(jobName, idempotencyKey, "failure", attempt, start, "ctx_done")
			return true, ctx.Err()
		case <-time.After(delay):
		}
	}
	j.logRun(jobName, idempotencyKey, "failure", attempt, start, "exhausted")
	return true, lastErr
}

func (j *JobRunner) tryLock(ctx context.Context, jobName, idemKey string) (kernel.JobLockDecision, *kernel.JobLockState, error) {
	key := j.lockKey(jobName)
	var existing *kernel.JobLockState
	if j.rdb != nil {
		raw, err := j.rdb.Get(ctx, key).Result()
		if err == nil && raw != "" {
			var st kernel.JobLockState
			if json.Unmarshal([]byte(raw), &st) == nil {
				existing = &st
			}
		}
	}
	now := time.Now().UTC()
	dec := kernel.TryAcquireJobLock(existing, kernel.JobLockRequest{
		JobName: jobName, OwnerID: j.ownerID, Now: now, TTL: j.ttl, IdempotencyKey: idemKey,
	})
	if !dec.Acquired {
		return dec, existing, nil
	}
	if j.rdb != nil && dec.NewState != nil {
		b, _ := json.Marshal(dec.NewState)
		// Prefer SET NX when free; if key exists but expired state allowed overwrite via Set.
		ok, err := j.rdb.SetNX(ctx, key, string(b), j.ttl).Result()
		if err != nil {
			return kernel.JobLockDecision{Acquired: false, Reason: "invalid"}, existing, err
		}
		if !ok {
			// Key held — re-check ownership/expiry via pure decision already said acquired
			// because existing was expired/nil; race with peer → skip.
			// Try unconditional set only if existing was nil or expired in our view and NX lost race.
			return kernel.JobLockDecision{Acquired: false, Reason: "held_by_other"}, existing, nil
		}
	}
	return dec, existing, nil
}

func (j *JobRunner) releaseIfOwner(ctx context.Context, jobName string) error {
	if j.rdb == nil {
		return nil
	}
	key := j.lockKey(jobName)
	raw, err := j.rdb.Get(ctx, key).Result()
	if err != nil {
		return nil
	}
	var st kernel.JobLockState
	if json.Unmarshal([]byte(raw), &st) != nil {
		return nil
	}
	if st.OwnerID == j.ownerID {
		return j.rdb.Del(ctx, key).Err()
	}
	return nil
}

func (j *JobRunner) logRun(jobName, idemKey, outcome string, attempt int, start time.Time, errClass string) {
	rec := kernel.JobRunRecord{
		TS:             time.Now().UTC(),
		JobName:        jobName,
		OwnerID:        j.ownerID,
		Outcome:        outcome,
		DurationMS:     time.Since(start).Milliseconds(),
		ErrorClass:     errClass,
		IdempotencyKey: idemKey,
		Attempt:        attempt,
		FormulaVersion: kernel.JobLockVersion,
	}
	// Structured, no PII/secrets
	log.Info().
		Str("job", rec.JobName).
		Str("owner", rec.OwnerID).
		Str("outcome", rec.Outcome).
		Int64("duration_ms", rec.DurationMS).
		Str("error_class", rec.ErrorClass).
		Str("idempotency_key", rec.IdempotencyKey).
		Int("attempt", rec.Attempt).
		Str("formula_version", rec.FormulaVersion).
		Msg("job_run")
}

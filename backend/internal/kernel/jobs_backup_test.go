package kernel

import (
	"testing"
	"time"
)

func TestTryAcquireJobLockFree(t *testing.T) {
	d := TryAcquireJobLock(nil, JobLockRequest{
		JobName: JobAlertGenerate, OwnerID: "replica-a", Now: time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), TTL: time.Minute,
	})
	if !d.Acquired || d.NewState == nil {
		t.Fatalf("%+v", d)
	}
}

func TestTryAcquireJobLockHeldByOther(t *testing.T) {
	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	existing := &JobLockState{
		JobName: JobAlertGenerate, OwnerID: "replica-a",
		AcquiredAt: now, ExpiresAt: now.Add(5 * time.Minute),
	}
	d := TryAcquireJobLock(existing, JobLockRequest{
		JobName: JobAlertGenerate, OwnerID: "replica-b", Now: now.Add(time.Minute), TTL: time.Minute,
	})
	if d.Acquired || d.Reason != "held_by_other" {
		t.Fatalf("%+v", d)
	}
}

func TestTryAcquireJobLockExpired(t *testing.T) {
	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	existing := &JobLockState{
		JobName: JobAlertGenerate, OwnerID: "replica-a",
		AcquiredAt: now.Add(-10 * time.Minute), ExpiresAt: now.Add(-5 * time.Minute),
	}
	d := TryAcquireJobLock(existing, JobLockRequest{
		JobName: JobAlertGenerate, OwnerID: "replica-b", Now: now, TTL: time.Minute,
	})
	if !d.Acquired {
		t.Fatalf("%+v", d)
	}
}

func TestTryAcquireJobLockIdempotentSkip(t *testing.T) {
	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	existing := &JobLockState{
		JobName: JobAlertGenerate, OwnerID: "replica-a", IdempotencyKey: "tick-1",
		AcquiredAt: now, ExpiresAt: now.Add(time.Hour),
	}
	d := TryAcquireJobLock(existing, JobLockRequest{
		JobName: JobAlertGenerate, OwnerID: "replica-a", Now: now.Add(time.Second),
		TTL: time.Minute, IdempotencyKey: "tick-1",
	})
	if d.Acquired || d.Reason != "idempotent_skip" {
		t.Fatalf("%+v", d)
	}
}

func TestNextRetryDelay(t *testing.T) {
	p := RetryPolicy{MaxAttempts: 3, BaseDelay: time.Second, MaxDelay: 10 * time.Second}
	if NextRetryDelay(p, 1) != time.Second {
		t.Fatal(NextRetryDelay(p, 1))
	}
	if NextRetryDelay(p, 2) != 2*time.Second {
		t.Fatal(NextRetryDelay(p, 2))
	}
	if NextRetryDelay(p, 3) != 0 {
		t.Fatal("no more retries")
	}
}

func TestBackupManifestChecksums(t *testing.T) {
	plain := []byte("pgdump-bytes")
	cipher := []byte("encrypted-bytes")
	m := BuildBackupManifest("backup_x.sql.enc", cipher, plain, "migrate-42", time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC))
	if err := VerifyBackupChecksums(m, cipher, plain); err != nil {
		t.Fatal(err)
	}
	if err := VerifyBackupChecksums(m, []byte("tamper"), plain); err == nil {
		t.Fatal("want mismatch")
	}
	v := MarkBackupVerified(m, "finance_restore_test", time.Date(2026, 7, 1, 1, 0, 0, 0, time.UTC))
	if !v.Verified || v.VerifyTarget == "" {
		t.Fatal(v)
	}
}

func TestSelectBackupsForRetention(t *testing.T) {
	now := time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC)
	var ms []BackupManifest
	for i := 0; i < 5; i++ {
		ms = append(ms, BackupManifest{
			FileName:  "b" + string(rune('a'+i)),
			CreatedAt: now.AddDate(0, 0, -i*40), // some older than 30d
		})
	}
	keep, purge := SelectBackupsForRetention(ms, now, 2)
	if len(keep) < 2 {
		t.Fatalf("keep %d purge %d", len(keep), len(purge))
	}
}

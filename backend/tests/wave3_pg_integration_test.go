package tests

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/user/financial-os/internal/handler"
)

func TestWave3PostgresStores(t *testing.T) {
	setupTestEnv(t)
	cleanDatabase(t)

	ctx := context.Background()
	ownerID := uuid.NewString()
	spouseID := uuid.NewString()

	// Seed real owner + spouse_co_owner users to verify migration 000021 role constraint and FK integrity.
	_, err := testDB.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, name, role, invited_by, is_active)
		VALUES
			($1, 'pg-owner@keluarga.id', '$2a$10$dummyhash', 'Owner PG', 'owner', NULL, true),
			($2, 'pg-spouse@keluarga.id', '$2a$10$dummyhash', 'Spouse PG', 'spouse_co_owner', $1, true)
	`, ownerID, spouseID)
	if err != nil {
		t.Fatalf("failed to seed users: %v", err)
	}

	t.Run("PgSyncStore", func(t *testing.T) {
		syncStore := handler.NewPgSyncStore(testDB)

		resolvedOwner, err := syncStore.ResolveHouseholdOwner(ctx, ownerID, "owner")
		if err != nil || resolvedOwner != ownerID {
			t.Fatalf("ResolveHouseholdOwner(owner) = %q, %v", resolvedOwner, err)
		}
		resolvedSpouse, err := syncStore.ResolveHouseholdOwner(ctx, spouseID, "spouse_co_owner")
		if err != nil || resolvedSpouse != ownerID {
			t.Fatalf("ResolveHouseholdOwner(spouse) = %q, %v", resolvedSpouse, err)
		}

		emptyEnv, err := syncStore.GetEnvelope(ctx, ownerID)
		if err != nil || emptyEnv != nil {
			t.Fatalf("expected nil envelope initially, got %+v, err=%v", emptyEnv, err)
		}

		env1, conflict, err := syncStore.PutEnvelope(ctx, ownerID, ownerID, handler.UpsertSyncEnvelopeRequest{
			BaseRevision:  0,
			CiphertextB64: "Y2lwaGVydGV4dC0x",
			IVB64:         "aXYtMQ==",
			SaltB64:       "c2FsdC0x",
			KDFIterations: 100000,
			DeviceID:      "android-owner",
		})
		if err != nil || conflict != nil || env1.Revision != 1 {
			t.Fatalf("PutEnvelope rev 0->1 failed: env=%+v conflict=%+v err=%v", env1, conflict, err)
		}

		// Stale BaseRevision = 0 must conflict and return current envelope
		_, staleCur, err := syncStore.PutEnvelope(ctx, ownerID, spouseID, handler.UpsertSyncEnvelopeRequest{
			BaseRevision:  0,
			CiphertextB64: "c3RhbGU=",
			IVB64:         "aXY=",
			SaltB64:       "c2FsdA==",
		})
		if err == nil || staleCur == nil || staleCur.Revision != 1 {
			t.Fatalf("expected stale rev conflict returning rev=1, got cur=%+v err=%v", staleCur, err)
		}

		env2, conflict, err := syncStore.PutEnvelope(ctx, ownerID, spouseID, handler.UpsertSyncEnvelopeRequest{
			BaseRevision:  1,
			CiphertextB64: "Y2lwaGVydGV4dC0y",
			IVB64:         "aXYtMg==",
			SaltB64:       "c2FsdC0y",
			KDFIterations: 120000,
			DeviceID:      "iphone-spouse",
		})
		if err != nil || conflict != nil || env2.Revision != 2 || env2.UpdatedBy != spouseID {
			t.Fatalf("PutEnvelope rev 1->2 failed: env=%+v conflict=%+v err=%v", env2, conflict, err)
		}

		fetched, err := syncStore.GetEnvelope(ctx, ownerID)
		if err != nil || fetched == nil || fetched.Revision != 2 || fetched.CiphertextB64 != "Y2lwaGVydGV4dC0y" {
			t.Fatalf("GetEnvelope after update failed: env=%+v err=%v", fetched, err)
		}
	})

	t.Run("PgApprovalStore", func(t *testing.T) {
		appStore := handler.NewPgApprovalStore(testDB)

		defSetting, err := appStore.GetSetting(ctx, ownerID)
		if err != nil || defSetting.ThresholdIDR != 0 {
			t.Fatalf("expected default threshold 0, got %+v, err=%v", defSetting, err)
		}

		if _, err := appStore.UpsertSetting(ctx, ownerID, 1500000); err != nil {
			t.Fatalf("UpsertSetting initial failed: %v", err)
		}
		updatedSetting, err := appStore.UpsertSetting(ctx, ownerID, 2000000)
		if err != nil || updatedSetting.ThresholdIDR != 2000000 {
			t.Fatalf("UpsertSetting update failed: setting=%+v err=%v", updatedSetting, err)
		}

		accUUID := uuid.NewString()
		txUUID := uuid.NewString()
		created, err := appStore.CreateApproval(ctx, &handler.TransactionApproval{
			HouseholdOwnerID: ownerID,
			RequestedBy:      spouseID,
			RequesterName:    "Spouse PG",
			AccountID:        accUUID,
			TxType:           "expense",
			Amount:           2750000,
			Date:             "2026-11-23",
			Description:      "Mesin Cuci Keluarga",
		})
		if err != nil {
			t.Fatalf("CreateApproval failed: %v", err)
		}
		if created.Status != "pending" || created.Amount != 2750000 || created.Date != "2026-11-23" {
			t.Fatalf("unexpected created approval: %+v", created)
		}

		pendingList, err := appStore.ListApprovals(ctx, ownerID, "pending")
		if err != nil || len(pendingList) != 1 || pendingList[0].ID != created.ID {
			t.Fatalf("ListApprovals(pending) failed: len=%d err=%v", len(pendingList), err)
		}

		fetched, err := appStore.GetApprovalByID(ctx, ownerID, created.ID)
		if err != nil || fetched.ID != created.ID || fetched.Amount != 2750000 {
			t.Fatalf("GetApprovalByID failed: item=%+v err=%v", fetched, err)
		}

		resolved, err := appStore.ResolveApproval(ctx, ownerID, created.ID, "approved", ownerID, "Disetujui untuk kebutuhan rumah", txUUID)
		if err != nil {
			t.Fatalf("ResolveApproval failed: %v", err)
		}
		if resolved.Status != "approved" || resolved.TransactionID == nil || *resolved.TransactionID != txUUID {
			t.Fatalf("unexpected resolved approval: %+v", resolved)
		}

		// Resolving an already resolved approval must fail
		if _, err := appStore.ResolveApproval(ctx, ownerID, created.ID, "rejected", ownerID, "dup", ""); err == nil {
			t.Fatalf("expected error on duplicate ResolveApproval")
		}
	})

	t.Run("PgChannelStore", func(t *testing.T) {
		chStore := handler.NewPgChannelStore(testDB)

		em1, err := chStore.EnsureInboundEmailToken(ctx, ownerID, ownerID, false)
		if err != nil || em1.SecretToken == "" {
			t.Fatalf("EnsureInboundEmailToken failed: %+v, err=%v", em1, err)
		}
		emSame, err := chStore.EnsureInboundEmailToken(ctx, ownerID, ownerID, false)
		if err != nil || emSame.SecretToken != em1.SecretToken {
			t.Fatalf("expected stable email token without rotation, got %q vs %q (err=%v)", emSame.SecretToken, em1.SecretToken, err)
		}

		foundEmail, err := chStore.FindByEmailToken(ctx, em1.SecretToken)
		if err != nil || foundEmail.HouseholdOwnerID != ownerID {
			t.Fatalf("FindByEmailToken failed: %+v, err=%v", foundEmail, err)
		}

		emRotated, err := chStore.EnsureInboundEmailToken(ctx, ownerID, ownerID, true)
		if err != nil || emRotated.SecretToken == "" || emRotated.SecretToken == em1.SecretToken {
			t.Fatalf("EnsureInboundEmailToken(rotate=true) failed: old=%q new=%+v err=%v", em1.SecretToken, emRotated, err)
		}
		if _, err := chStore.FindByEmailToken(ctx, em1.SecretToken); err == nil {
			t.Fatalf("expected old email token to be deactivated after rotation")
		}

		tg1, err := chStore.UpsertTelegramLink(ctx, ownerID, ownerID, "99887766")
		if err != nil || tg1.ExternalID != "99887766" {
			t.Fatalf("UpsertTelegramLink insert failed: %+v, err=%v", tg1, err)
		}
		// Upsert same chat ID to spouse user -> exercises ON CONFLICT (channel_type, external_id) DO UPDATE
		tg2, err := chStore.UpsertTelegramLink(ctx, ownerID, spouseID, "99887766")
		if err != nil || tg2.UserID != spouseID {
			t.Fatalf("UpsertTelegramLink conflict update failed: %+v, err=%v", tg2, err)
		}

		foundTG, err := chStore.FindByTelegramChatID(ctx, "99887766")
		if err != nil || foundTG.UserID != spouseID {
			t.Fatalf("FindByTelegramChatID failed: %+v, err=%v", foundTG, err)
		}

		links, err := chStore.GetHouseholdChannels(ctx, ownerID)
		if err != nil || len(links) != 2 {
			t.Fatalf("expected 2 active household channels (email + telegram), got %d (err=%v)", len(links), err)
		}
	})

	t.Run("PgPasskeyStore", func(t *testing.T) {
		pkStore := handler.NewPgPasskeyStore(testDB)

		uid, err := pkStore.FindUserIDByEmail(ctx, "  PG-OWNER@KELUARGA.ID  ")
		if err != nil || uid != ownerID {
			t.Fatalf("FindUserIDByEmail failed: uid=%q err=%v", uid, err)
		}

		saved, err := pkStore.SaveCredential(ctx, &handler.PasskeyCredential{
			UserID:           ownerID,
			CredentialID:     "pg-cred-001",
			PublicKeySPKIB64: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
			Algorithm:        "ES256",
			DeviceName:       "Pixel 9 Biometric",
			SignCount:        0,
		})
		if err != nil || saved.ID == "" {
			t.Fatalf("SaveCredential failed: %+v, err=%v", saved, err)
		}

		// Conflict update on credential_id preserves record and updates device_name
		updatedCred, err := pkStore.SaveCredential(ctx, &handler.PasskeyCredential{
			UserID:           ownerID,
			CredentialID:     "pg-cred-001",
			PublicKeySPKIB64: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
			Algorithm:        "ES256",
			DeviceName:       "Pixel 9 Pro",
			SignCount:        0,
		})
		if err != nil || updatedCred.DeviceName != "Pixel 9 Pro" {
			t.Fatalf("SaveCredential ON CONFLICT update failed: %+v, err=%v", updatedCred, err)
		}

		if err := pkStore.UpdateSignCount(ctx, "pg-cred-001", 12); err != nil {
			t.Fatalf("UpdateSignCount failed: %v", err)
		}

		found, err := pkStore.FindByCredentialID(ctx, "pg-cred-001")
		if err != nil || found.SignCount != 12 || found.LastUsedAt == nil {
			t.Fatalf("FindByCredentialID after UpdateSignCount failed: %+v, err=%v", found, err)
		}

		list, err := pkStore.ListByUser(ctx, ownerID)
		if err != nil || len(list) != 1 {
			t.Fatalf("ListByUser expected 1 credential, got %d (err=%v)", len(list), err)
		}

		if err := pkStore.DeleteByID(ctx, ownerID, found.ID); err != nil {
			t.Fatalf("DeleteByID failed: %v", err)
		}
		listAfter, err := pkStore.ListByUser(ctx, ownerID)
		if err != nil || len(listAfter) != 0 {
			t.Fatalf("expected 0 credentials after DeleteByID, got %d (err=%v)", len(listAfter), err)
		}
	})

	t.Run("PgTelemetryStore", func(t *testing.T) {
		telStore := handler.NewPgTelemetryStore(testDB)

		if err := telStore.SaveEvent(ctx, &handler.ClientErrorEvent{
			UserID:     &ownerID,
			Platform:   "android",
			AppVersion: "1.0.0",
			Message:    "E2EE pull timeout",
			Stack:      "at pullAndMerge",
			Route:      "/settings/account",
			Metadata:   map[string]interface{}{"network": "offline", "attempt": float64(2)},
		}); err != nil {
			t.Fatalf("SaveEvent(user) failed: %v", err)
		}

		if err := telStore.SaveEvent(ctx, &handler.ClientErrorEvent{
			UserID:     nil,
			Platform:   "web",
			AppVersion: "1.0.0",
			Message:    "Pre-login passkey abort",
			Route:      "/login",
			Metadata:   map[string]interface{}{"browser": "safari"},
		}); err != nil {
			t.Fatalf("SaveEvent(anon) failed: %v", err)
		}

		events, err := telStore.ListRecent(ctx, 10)
		if err != nil || len(events) != 2 {
			t.Fatalf("ListRecent expected 2 events, got %d (err=%v)", len(events), err)
		}
		// Most recent inserted second ("Pre-login passkey abort") comes first or both present with JSONB metadata intact
		seenMsgs := map[string]bool{}
		for _, ev := range events {
			seenMsgs[ev.Message] = true
			if ev.Message == "E2EE pull timeout" {
				if ev.UserID == nil || *ev.UserID != ownerID || ev.Metadata["network"] != "offline" {
					t.Fatalf("unexpected telemetry event round-trip: %+v", ev)
				}
			}
		}
		if !seenMsgs["E2EE pull timeout"] || !seenMsgs["Pre-login passkey abort"] {
			t.Fatalf("missing expected telemetry messages: %+v", seenMsgs)
		}
	})

	t.Run("PgLegacyCheckInStore", func(t *testing.T) {
		legStore := handler.NewPgLegacyCheckInStore(testDB)

		defCfg, err := legStore.GetConfig(ctx, ownerID)
		if err != nil || defCfg.Enabled || defCfg.IntervalDays != 7 {
			t.Fatalf("unexpected default legacy config: %+v err=%v", defCfg, err)
		}

		savedBens, err := legStore.ReplaceBeneficiaries(ctx, ownerID, []handler.LegacyBeneficiary{
			{Name: "Siti PG", Relationship: "Istri", Email: "siti-pg@keluarga.id", TelegramChatID: "123123"},
		})
		if err != nil || len(savedBens) != 1 {
			t.Fatalf("ReplaceBeneficiaries failed: %+v err=%v", savedBens, err)
		}

		now := time.Now().UTC().Truncate(time.Second)
		nextDue := now.Add(7 * 24 * time.Hour)
		todayStr := now.Format("2006-01-02")
		cfg, err := legStore.UpsertConfig(ctx, &handler.LegacyCheckInConfig{
			UserID:               ownerID,
			Enabled:              true,
			IntervalDays:         7,
			GracePeriodDays:      3,
			ReminderHour:         20,
			Timezone:             "Asia/Jakarta",
			AutoResetOnActivity:  true,
			DeliveryMode:         "e2ee_portal",
			OwnerNotifyEmail:     true,
			OwnerNotifyTelegram:  true,
			Status:               "triggered",
			LastCheckinAt:        &now,
			NextDueAt:            &nextDue,
			TriggeredAt:          &now,
			LastReminderSentDate: &todayStr,
			EncryptedPackage: &handler.LegacyEncryptedPackage{
				Version:       1,
				CiphertextB64: "ZW5jcnlwdGVkLXBn",
				IVB64:         "aXYtcGc=",
				SaltB64:       "c2FsdC1wZw==",
				KDFIterations: 100000,
				UpdatedAt:     now.Format(time.RFC3339),
			},
			PlaintextSummaryNote: "Lokasi map dokumen keluarga di brankas kamar.",
		})
		if err != nil || !cfg.Enabled || cfg.EncryptedPackage == nil || cfg.EncryptedPackage.CiphertextB64 != "ZW5jcnlwdGVkLXBn" {
			t.Fatalf("UpsertConfig failed: %+v err=%v", cfg, err)
		}

		if err := legStore.AppendEvent(ctx, ownerID, "triggered_released", "Test PG release"); err != nil {
			t.Fatalf("AppendEvent failed: %v", err)
		}
		evs, err := legStore.ListEvents(ctx, ownerID, 5)
		if err != nil || len(evs) != 1 || evs[0].EventType != "triggered_released" {
			t.Fatalf("ListEvents failed: %+v err=%v", evs, err)
		}

		sum := sha256.Sum256([]byte("pg-raw-claim-token"))
		tokHash := hex.EncodeToString(sum[:])
		if err := legStore.InsertClaimToken(ctx, &handler.LegacyClaimTokenRecord{
			TokenHash:        tokHash,
			UserID:           ownerID,
			BeneficiaryID:    savedBens[0].ID,
			BeneficiaryName:  savedBens[0].Name,
			BeneficiaryEmail: savedBens[0].Email,
			ExpiresAt:        now.Add(24 * time.Hour),
		}); err != nil {
			t.Fatalf("InsertClaimToken failed: %v", err)
		}

		rec, claimedCfg, meta, err := legStore.ClaimByTokenHash(ctx, tokHash, now)
		if err != nil || rec.BeneficiaryEmail != "siti-pg@keluarga.id" || claimedCfg.EncryptedPackage.CiphertextB64 != "ZW5jcnlwdGVkLXBn" {
			t.Fatalf("ClaimByTokenHash failed: rec=%+v cfg=%+v meta=%+v err=%v", rec, claimedCfg, meta, err)
		}

		summary, err := legStore.BuildReadableInventorySummary(ctx, ownerID)
		if err != nil || !strings.Contains(summary, "RINGKASAN INVENTARIS KELUARGA") {
			t.Fatalf("BuildReadableInventorySummary failed: %q err=%v", summary, err)
		}
	})
}

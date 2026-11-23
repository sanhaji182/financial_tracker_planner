package kernel

import "testing"

func TestHouseholdAuthzOwnerFull(t *testing.T) {
	d := HouseholdAuthz(RoleOwner, ResVault, ActDelete, false)
	if !d.Allowed {
		t.Fatal(d)
	}
}

func TestHouseholdAuthzSpouseDeniedVaultBackup(t *testing.T) {
	for _, res := range []string{ResVault, ResBackup, ResAISettings, ResExport, ResAudit} {
		d := HouseholdAuthz(RoleSpouseViewer, res, ActRead, true)
		if d.Allowed {
			t.Fatalf("%s should deny spouse: %+v", res, d)
		}
	}
}

func TestHouseholdAuthzSpousePrivateAsset(t *testing.T) {
	d := HouseholdAuthz(RoleSpouseViewer, ResAsset, ActRead, false)
	if d.Allowed {
		t.Fatal("private asset denied")
	}
	d2 := HouseholdAuthz(RoleSpouseViewer, ResAsset, ActRead, true)
	if !d2.Allowed {
		t.Fatal("shared asset allowed")
	}
}

func TestHouseholdAuthzSpouseNoWrite(t *testing.T) {
	d := HouseholdAuthz(RoleSpouseViewer, ResTransaction, ActWrite, false)
	if d.Allowed {
		t.Fatal("spouse write denied")
	}
}

func TestHouseholdAuthzDenyByDefault(t *testing.T) {
	d := HouseholdAuthz(RoleSpouseViewer, "unknown_res", ActRead, false)
	if d.Allowed {
		t.Fatal("deny default")
	}
	d2 := HouseholdAuthz("hacker", ResDashboard, ActRead, false)
	if d2.Allowed {
		t.Fatal("unknown role")
	}
}

func TestBuildAuthzMatrixNonEmpty(t *testing.T) {
	rows := BuildAuthzMatrix()
	if len(rows) < 20 {
		t.Fatalf("rows %d", len(rows))
	}
}

func TestHouseholdAuthzSpouseCoOwner(t *testing.T) {
	if d := HouseholdAuthz(RoleSpouseCoOwner, ResTransaction, ActWrite, false); !d.Allowed {
		t.Fatalf("co-owner should write transactions: %+v", d)
	}
	if d := HouseholdAuthz(RoleSpouseCoOwner, ResTransaction, ActDelete, false); d.Allowed {
		t.Fatalf("co-owner must not delete transactions: %+v", d)
	}
	if d := HouseholdAuthz(RoleSpouseCoOwner, ResAccount, ActRead, true); !d.Allowed {
		t.Fatalf("co-owner should read shared account: %+v", d)
	}
	if d := HouseholdAuthz(RoleSpouseCoOwner, ResAccount, ActRead, false); d.Allowed {
		t.Fatalf("co-owner must be denied private account: %+v", d)
	}
	for _, res := range []string{ResVault, ResBackup, ResAISettings, ResAudit} {
		if d := HouseholdAuthz(RoleSpouseCoOwner, res, ActRead, true); d.Allowed {
			t.Fatalf("co-owner must be denied %s: %+v", res, d)
		}
	}
}

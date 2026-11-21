package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/kernel"
)

func TestRoleMiddlewareOwnerVsSpouse(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		role, res, act string
		shared         bool
		want           bool
	}{
		{kernel.RoleOwner, kernel.ResVault, kernel.ActRead, false, true},
		{kernel.RoleSpouseViewer, kernel.ResVault, kernel.ActRead, true, false},
		{kernel.RoleSpouseViewer, kernel.ResBackup, kernel.ActRead, true, false},
		{kernel.RoleSpouseViewer, kernel.ResExport, kernel.ActExport, true, false},
		{kernel.RoleSpouseViewer, kernel.ResAsset, kernel.ActRead, false, false},
		{kernel.RoleSpouseViewer, kernel.ResAsset, kernel.ActRead, true, true},
		{kernel.RoleSpouseViewer, kernel.ResDashboard, kernel.ActRead, false, true},
		{kernel.RoleSpouseViewer, kernel.ResTransaction, kernel.ActWrite, false, false},
	}
	for _, tc := range cases {
		d := kernel.HouseholdAuthz(tc.role, tc.res, tc.act, tc.shared)
		if d.Allowed != tc.want {
			t.Fatalf("%s %s %s shared=%v: got %v want %v (%s)",
				tc.role, tc.res, tc.act, tc.shared, d.Allowed, tc.want, d.Reason)
		}
	}
}

func TestRoleMiddlewareHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// spouse_viewer must be blocked from owner-only
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/owner-only", nil)
	c.Set("role", "spouse_viewer")
	RoleMiddleware("owner")(c)
	if !c.IsAborted() {
		t.Fatal("spouse should be aborted on owner-only")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("code %d want 403", w.Code)
	}

	// owner must pass
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodGet, "/owner-only", nil)
	c2.Set("role", "owner")
	RoleMiddleware("owner")(c2)
	if c2.IsAborted() {
		t.Fatal("owner should pass")
	}
}

package model

import "time"

// Scenario represents a saved what-if scenario planner template
type Scenario struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Changes   []byte    `json:"changes"` // JSONB bytes
	Result    []byte    `json:"result"`  // JSONB bytes
	CreatedAt time.Time `json:"created_at"`
}

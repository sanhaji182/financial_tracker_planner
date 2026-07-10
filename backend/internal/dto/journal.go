package dto

import "time"

type HouseholdNoteResponse struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	Title              string    `json:"title"`
	Content            string    `json:"content"`
	Tags               []string  `json:"tags"`
	NoteDate           string    `json:"note_date"` // YYYY-MM-DD
	CreatedAt          time.Time `json:"created_at"`
	FormattedNoteDate  string    `json:"formatted_note_date"`
}

type CreateHouseholdNoteRequest struct {
	Title    string   `json:"title" binding:"required"`
	Content  string   `json:"content"`
	Tags     []string `json:"tags"`
	NoteDate string   `json:"note_date"` // YYYY-MM-DD (optional, default today)
}

type UpdateHouseholdNoteRequest struct {
	Title    *string   `json:"title"`
	Content  *string   `json:"content"`
	Tags     *[]string `json:"tags"`
	NoteDate *string   `json:"note_date"` // YYYY-MM-DD
}

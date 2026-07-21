package services

import (
	"database/sql"
	"time"
)

type AuditService struct {
	db *sql.DB
}

func NewAuditService(db *sql.DB) *AuditService {
	return &AuditService{db: db}
}

type AuditEntry struct {
	ID        int64     `json:"id"`
	UserID    *string   `json:"userId"`
	UserEmail *string   `json:"userEmail"`
	Action    string    `json:"action"`
	EntityType *string  `json:"entityType"`
	EntityID  *string   `json:"entityId"`
	Details   string    `json:"details"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *AuditService) Log(userID, userEmail, action, entityType, entityID, details string) {
	var uid, uemail, eid, et sql.NullString
	if userID != "" {
		uid = sql.NullString{String: userID, Valid: true}
	}
	if userEmail != "" {
		uemail = sql.NullString{String: userEmail, Valid: true}
	}
	if entityType != "" {
		et = sql.NullString{String: entityType, Valid: true}
	}
	if entityID != "" {
		eid = sql.NullString{String: entityID, Valid: true}
	}
	s.db.Exec(`INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, details)
		VALUES (?, ?, ?, ?, ?, ?)`,
		uid, uemail, action, et, eid, details,
	)
}

func (s *AuditService) List(page, limit int, actionFilter string) ([]AuditEntry, int, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	offset := (page - 1) * limit

	var total int
	var countQuery string
	var args []interface{}

	if actionFilter != "" {
		countQuery = "SELECT COUNT(*) FROM audit_log WHERE action = ?"
		args = append(args, actionFilter)
	} else {
		countQuery = "SELECT COUNT(*) FROM audit_log"
	}
	s.db.QueryRow(countQuery, args...).Scan(&total)

	var rows *sql.Rows
	var err error
	query := `SELECT id, user_id, user_email, action, entity_type, entity_id, details, created_at FROM audit_log`
	if actionFilter != "" {
		query += " WHERE action = ?"
		query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
		args = append(args, limit, offset)
		rows, err = s.db.Query(query, args...)
	} else {
		query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
		rows, err = s.db.Query(query, limit, offset)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.UserEmail, &e.Action, &e.EntityType, &e.EntityID, &e.Details, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		entries = append(entries, e)
	}
	return entries, total, rows.Err()
}

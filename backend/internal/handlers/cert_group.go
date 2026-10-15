package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/gugabguerra/glcert/internal/logger"
)

func (h *CertHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r.Context())
	caCond, caArgs, filtered := h.accessibleCAFilter(userID)

	query := `
		SELECT DISTINCT group_name, COUNT(*) as cert_count
		FROM certificates
		WHERE group_name != ''
	`
	var args []interface{}
	if filtered {
		query += " AND " + caCond
	}
	args = append(args, caArgs...)
	query += `
		GROUP BY group_name
		ORDER BY group_name
	`

	rows, err := h.db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Group struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	var groups []Group
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.Name, &g.Count); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		groups = append(groups, g)
	}

	if groups == nil {
		groups = []Group{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(groups)
}

type UpdateGroupRequest struct {
	GroupName   string  `json:"groupName"`
	Description *string `json:"description,omitempty"`
}

func (h *CertHandler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM certificates WHERE id = ?)", id).Scan(&exists)
	if err != nil || !exists {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var req UpdateGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Description != nil {
		if _, err := h.db.Exec("UPDATE certificates SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", *req.Description, id); err != nil {
			logger.Errorf("Update description: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if _, err := h.db.Exec("UPDATE certificates SET group_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", req.GroupName, id); err != nil {
		logger.Errorf("Update group: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"groupName": req.GroupName})
}

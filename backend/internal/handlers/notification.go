package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gugabguerra/glcert/internal/services"
)

type NotificationHandler struct {
	notification *services.NotificationService
}

func NewNotificationHandler(notification *services.NotificationService) *NotificationHandler {
	return &NotificationHandler{notification: notification}
}

func (h *NotificationHandler) TestNotification(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WebhookURL string `json:"webhookUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.WebhookURL == "" {
		http.Error(w, "webhook URL is required", http.StatusBadRequest)
		return
	}

	if err := h.notification.SendTestNotification(req.WebhookURL); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

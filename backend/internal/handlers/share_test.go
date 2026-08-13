package handlers

import (
	"strings"
	"testing"
)

func TestBuildShareEmailBodyEscapesUserInput(t *testing.T) {
	body := buildShareEmailBody(
		`cert" onclick="alert(1)`,
		`https://example.test/api/share/tok"; autofocus onfocus="alert(2)`,
	)

	if strings.Contains(body, `<script`) {
		t.Fatal("body must not contain raw script tags")
	}
	if strings.Contains(body, `" onclick=`) {
		t.Fatalf("body must escape attribute injection, got: %s", body)
	}
	if strings.Contains(body, `"; autofocus`) {
		t.Fatalf("body must escape attribute-breaking quote in URL, got: %s", body)
	}
	if strings.Contains(body, `onclick="`) || strings.Contains(body, `autofocus onfocus="`) {
		t.Fatalf("body must not contain raw event-handler markup, got: %s", body)
	}
}

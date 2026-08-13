package handlers

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// rateLimiter implements per-client-IP token buckets with bounded growth and
// stale-entry pruning. It deliberately ignores X-Forwarded-For so clients
// cannot spoof their way around the limit.
type rateLimiter struct {
	mu      sync.Mutex
	clients map[string]*clientLimiter
	limit   rate.Limit
	burst   int
}

type clientLimiter struct {
	limiter *rate.Limiter
	last    time.Time
}

func newRateLimiter(r rate.Limit, burst int) *rateLimiter {
	return &rateLimiter{
		clients: make(map[string]*clientLimiter),
		limit:   r,
		burst:   burst,
	}
}

func (rl *rateLimiter) allow(ip string) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if len(rl.clients) >= 10000 {
		for k, v := range rl.clients {
			if now.Sub(v.last) > 10*time.Minute {
				delete(rl.clients, k)
			}
		}
	}

	c, ok := rl.clients[ip]
	if !ok {
		c = &clientLimiter{limiter: rate.NewLimiter(rl.limit, rl.burst)}
		rl.clients[ip] = c
	}
	c.last = now
	return c.limiter.Allow()
}

// RateLimit returns a middleware that throttles each client IP.
func RateLimit(limit rate.Limit, burst int) func(http.Handler) http.Handler {
	rl := newRateLimiter(limit, burst)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !rl.allow(clientIP(r)) {
				http.Error(w, "too many requests", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// clientIP extracts the immediate peer IP (not proxy headers).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
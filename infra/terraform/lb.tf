# ---------------------------------------------------------------------------
# lb.tf
# All GCP Global HTTP(S) Load Balancer resources:
#
#   1. Static global IP address
#   2. Google-managed SSL certificate
#   3. Unmanaged instance group (wraps the existing GCE VM)
#   4. HTTP health check (GET / on the frontend port)
#   5. Backend service (points to the instance group via named port)
#   6. URL map — HTTPS traffic routed to the backend service
#   7. HTTPS target proxy + forwarding rule  (port 443)
#   8. HTTP → HTTPS redirect url map + proxy + forwarding rule  (port 80)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 1. Static global IP
# ---------------------------------------------------------------------------
resource "google_compute_global_address" "lb_ip" {
  name         = "${var.lb_name_prefix}-lb-ip"
  project      = var.project_id
  address_type = "EXTERNAL"
  ip_version   = "IPV4"

  description = "Static external IP for the ${var.lb_name_prefix} HTTPS load balancer."
}

# ---------------------------------------------------------------------------
# 2. Google-managed SSL certificate
#    GCP auto-provisions and renews the cert once DNS resolves to lb_ip.
# ---------------------------------------------------------------------------
resource "google_compute_managed_ssl_certificate" "lb_cert" {
  name    = "${var.lb_name_prefix}-managed-cert"
  project = var.project_id

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# 3. Unmanaged instance group — wraps the single existing GCE VM
#    Named port "http" maps to the docker-compose frontend port (default 3000).
# ---------------------------------------------------------------------------
resource "google_compute_instance_group" "vm_group" {
  name        = "${var.lb_name_prefix}-vm-group"
  description = "Unmanaged instance group containing the docker-compose host VM."
  zone        = var.zone
  project     = var.project_id
  network     = data.google_compute_network.vpc.self_link

  instances = [
    data.google_compute_instance.vm.self_link,
  ]

  named_port {
    name = "http"
    port = var.frontend_port
  }
}

# ---------------------------------------------------------------------------
# 4. HTTP health check
#    GCP probes GET / on var.frontend_port to determine backend health.
# ---------------------------------------------------------------------------
resource "google_compute_health_check" "frontend_hc" {
  name    = "${var.lb_name_prefix}-frontend-hc"
  project = var.project_id

  check_interval_sec  = var.health_check_interval_sec
  timeout_sec         = var.health_check_timeout_sec
  healthy_threshold   = var.health_check_healthy_threshold
  unhealthy_threshold = var.health_check_unhealthy_threshold

  http_health_check {
    port         = var.frontend_port
    request_path = "/"
  }

  description = "Health check for the Next.js frontend on port ${var.frontend_port}."
}

# ---------------------------------------------------------------------------
# 5. Backend service
#    Routes traffic to the instance group using the named port "http".
# ---------------------------------------------------------------------------
resource "google_compute_backend_service" "frontend_backend" {
  name                  = "${var.lb_name_prefix}-frontend-backend"
  project               = var.project_id
  protocol              = "HTTP"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL"
  timeout_sec           = 30

  health_checks = [google_compute_health_check.frontend_hc.id]

  backend {
    group           = google_compute_instance_group.vm_group.self_link
    balancing_mode  = "UTILIZATION"
    capacity_scaler = 1.0
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  description = "Backend service for the ${var.lb_name_prefix} Next.js frontend."
}

# ---------------------------------------------------------------------------
# 6. URL map — HTTPS traffic
#    All paths (/*) are forwarded to the frontend backend service.
# ---------------------------------------------------------------------------
resource "google_compute_url_map" "https_url_map" {
  name            = "${var.lb_name_prefix}-https-url-map"
  project         = var.project_id
  default_service = google_compute_backend_service.frontend_backend.id

  description = "Routes all HTTPS traffic to the ${var.lb_name_prefix} frontend."
}

# ---------------------------------------------------------------------------
# 7. HTTPS target proxy + forwarding rule  (port 443)
# ---------------------------------------------------------------------------
resource "google_compute_target_https_proxy" "https_proxy" {
  name             = "${var.lb_name_prefix}-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.https_url_map.id
  ssl_certificates = [google_compute_managed_ssl_certificate.lb_cert.id]

  description = "HTTPS proxy with Google-managed SSL cert for ${var.domain}."
}

resource "google_compute_global_forwarding_rule" "https_forwarding_rule" {
  name                  = "${var.lb_name_prefix}-https-fwd-rule"
  project               = var.project_id
  target                = google_compute_target_https_proxy.https_proxy.id
  ip_address            = google_compute_global_address.lb_ip.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL"

  description = "Forwards port 443 (HTTPS) to the ${var.lb_name_prefix} HTTPS proxy."
}

# ---------------------------------------------------------------------------
# 8. HTTP → HTTPS redirect  (port 80)
#    A separate URL map issues a 301 redirect; no traffic reaches the backend.
# ---------------------------------------------------------------------------
resource "google_compute_url_map" "http_redirect_map" {
  name    = "${var.lb_name_prefix}-http-redirect-map"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT" # 301
    strip_query            = false
  }

  description = "Redirects all HTTP traffic to HTTPS for ${var.domain}."
}

resource "google_compute_target_http_proxy" "http_proxy" {
  name    = "${var.lb_name_prefix}-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.http_redirect_map.id

  description = "HTTP proxy that enforces redirect to HTTPS."
}

resource "google_compute_global_forwarding_rule" "http_forwarding_rule" {
  name                  = "${var.lb_name_prefix}-http-fwd-rule"
  project               = var.project_id
  target                = google_compute_target_http_proxy.http_proxy.id
  ip_address            = google_compute_global_address.lb_ip.id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL"

  description = "Forwards port 80 (HTTP) to the redirect proxy for ${var.domain}."
}

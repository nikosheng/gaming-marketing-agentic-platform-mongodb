# ---------------------------------------------------------------------------
# firewall.tf
# Opens the frontend port (default 3000) on the existing GCE VM exclusively
# to GCP's health checker and load balancer IP ranges.
#
# GCP documentation references:
#   Health checker ranges : 35.191.0.0/16, 130.211.0.0/22
#   LB proxy range (same) : included above
#
# NO inbound port 3000 is opened to the public internet — all external
# traffic must arrive via the load balancer on port 443.
# ---------------------------------------------------------------------------

resource "google_compute_firewall" "allow_lb_health_check" {
  name    = "${var.lb_name_prefix}-allow-lb-hc"
  project = var.project_id
  network = data.google_compute_network.vpc.name

  description = "Allow GCP load balancer health checkers to reach the frontend on port ${var.frontend_port}. Source ranges are the documented GCP health-check IP ranges."

  direction = "INGRESS"
  priority  = 1000

  # GCP global load balancer and health checker source ranges (documented, stable).
  source_ranges = [
    "35.191.0.0/16",
    "130.211.0.0/22",
  ]

  allow {
    protocol = "tcp"
    ports    = [tostring(var.frontend_port)]
  }

  # Apply this rule only to VMs with this network tag.
  # Add the tag "mgm-platform-frontend" to your existing GCE VM so that
  # this rule is scoped correctly and does not affect other VMs.
  target_tags = ["${var.lb_name_prefix}-frontend"]
}

# ---------------------------------------------------------------------------
# Optional: block direct internet access to port 3000 explicitly.
# Uncomment if your VPC has an overly permissive "allow-all" ingress rule
# and you want to ensure port 3000 is never reachable from arbitrary IPs.
# ---------------------------------------------------------------------------
# resource "google_compute_firewall" "deny_direct_frontend" {
#   name    = "${var.lb_name_prefix}-deny-direct-frontend"
#   project = var.project_id
#   network = data.google_compute_network.vpc.name
#
#   description = "Deny direct internet access to the frontend port; traffic must flow through the LB."
#
#   direction = "INGRESS"
#   priority  = 900   # higher priority than allow-lb-hc (lower number = higher priority)
#
#   source_ranges = ["0.0.0.0/0"]
#
#   deny {
#     protocol = "tcp"
#     ports    = [tostring(var.frontend_port)]
#   }
#
#   target_tags = ["${var.lb_name_prefix}-frontend"]
# }

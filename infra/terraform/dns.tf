# ---------------------------------------------------------------------------
# dns.tf
# Manages the Cloud DNS A record for the load balancer domain.
#
# This file references an EXISTING Cloud DNS managed zone (data source only —
# Terraform will not create or destroy the zone itself) and creates a single
# A record pointing the domain to the static LB IP.
#
#   platform.themongodb.com  →  A  →  <google_compute_global_address.lb_ip>
#
# The record is what triggers Google's managed SSL certificate to begin
# provisioning. Allow up to 15 minutes after apply for the cert to go ACTIVE.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Data source — look up the existing Cloud DNS zone (no changes made to it)
# ---------------------------------------------------------------------------
data "google_dns_managed_zone" "zone" {
  name    = var.dns_zone_name
  project = var.project_id
}

# ---------------------------------------------------------------------------
# A record — platform.<domain>  →  static LB IP
# TTL of 300s (5 min) balances propagation speed with caching efficiency.
# ---------------------------------------------------------------------------
resource "google_dns_record_set" "frontend_a" {
  name         = "${var.domain}."   # trailing dot is required by Cloud DNS
  type         = "A"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.zone.name
  project      = var.project_id

  rrdatas = [google_compute_global_address.lb_ip.address]
}

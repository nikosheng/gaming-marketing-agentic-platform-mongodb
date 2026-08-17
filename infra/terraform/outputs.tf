# ---------------------------------------------------------------------------
# outputs.tf
# Values printed after `terraform apply` and available via `terraform output`.
# ---------------------------------------------------------------------------

output "lb_ip" {
  description = "Static external IPv4 address of the load balancer. Create a DNS A record pointing your domain to this IP to enable TLS certificate provisioning."
  value       = google_compute_global_address.lb_ip.address
}

output "lb_https_url" {
  description = "HTTPS URL vendors use to access the platform frontend."
  value       = "https://${var.domain}"
}

output "lb_http_url" {
  description = "HTTP URL (will 301-redirect to HTTPS automatically)."
  value       = "http://${var.domain}"
}

output "managed_cert_name" {
  description = "Name of the Google-managed SSL certificate resource. Use this to monitor cert provisioning status in the GCP Console or via: gcloud compute ssl-certificates describe <name> --global"
  value       = google_compute_managed_ssl_certificate.lb_cert.name
}

output "instance_group_self_link" {
  description = "Self-link of the unmanaged instance group wrapping the docker-compose VM."
  value       = google_compute_instance_group.vm_group.self_link
}

output "backend_service_name" {
  description = "Name of the backend service resource (useful for gcloud / Cloud Console navigation)."
  value       = google_compute_backend_service.frontend_backend.name
}

output "dns_setup_instruction" {
  description = "Human-readable reminder of the manual DNS step required after apply."
  value       = "ACTION REQUIRED: Add a DNS A record -> ${google_compute_global_address.lb_ip.address} for ${var.domain}. The Google-managed SSL cert will not provision until DNS resolves. Allow up to 15 minutes after DNS propagation."
}

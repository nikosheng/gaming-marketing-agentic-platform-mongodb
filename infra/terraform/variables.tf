# ---------------------------------------------------------------------------
# variables.tf
# All input variables for the GCP Load Balancer Terraform module.
# Copy terraform.tfvars.example → terraform.tfvars and fill in real values.
# ---------------------------------------------------------------------------

variable "project_id" {
  description = "GCP project ID where all resources will be provisioned."
  type        = string
}

variable "region" {
  description = "GCP region of the existing VM (e.g. 'us-central1')."
  type        = string
}

variable "zone" {
  description = "GCP zone of the existing VM (e.g. 'us-central1-a')."
  type        = string
}

variable "network" {
  description = "Name of the existing VPC network the VM is attached to."
  type        = string
  default     = "default"
}

variable "vm_name" {
  description = "Name of the existing GCE VM instance running docker-compose."
  type        = string
}

variable "domain" {
  description = "Fully-qualified domain name to attach to the load balancer (e.g. 'platform.example.com'). A Google-managed SSL certificate will be provisioned for this domain. Point your DNS A record to the output lb_ip after apply."
  type        = string
}

variable "frontend_port" {
  description = "Host port that the docker-compose frontend container exposes on the VM."
  type        = number
  default     = 3000
}

variable "lb_name_prefix" {
  description = "Short prefix used to name all load balancer resources. Change this to deploy multiple LB stacks in the same project."
  type        = string
  default     = "mgm-platform"
}

variable "health_check_interval_sec" {
  description = "How often (in seconds) the GCP health checker polls the frontend."
  type        = number
  default     = 30
}

variable "health_check_timeout_sec" {
  description = "Timeout (in seconds) for each individual health check probe."
  type        = number
  default     = 10
}

variable "health_check_healthy_threshold" {
  description = "Number of consecutive successes before a backend is marked healthy."
  type        = number
  default     = 2
}

variable "health_check_unhealthy_threshold" {
  description = "Number of consecutive failures before a backend is marked unhealthy."
  type        = number
  default     = 3
}

variable "dns_zone_name" {
  description = "Resource name of the existing Cloud DNS managed zone in the GCP project (e.g. 'themongodb-com'). This is the zone's short name, not the DNS name. Find it with: gcloud dns managed-zones list --project=<project_id>"
  type        = string
}

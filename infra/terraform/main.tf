# ---------------------------------------------------------------------------
# main.tf
# Provider configuration and data sources that reference existing GCP
# resources (project, VPC, and the GCE VM running docker-compose).
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# Data sources — resolve existing resources, no changes are made to them
# ---------------------------------------------------------------------------

# Look up the existing GCE VM so we can add it to the unmanaged instance group.
data "google_compute_instance" "vm" {
  name    = var.vm_name
  zone    = var.zone
  project = var.project_id
}

# Look up the existing VPC network so firewall rules target the right network.
data "google_compute_network" "vpc" {
  name    = var.network
  project = var.project_id
}

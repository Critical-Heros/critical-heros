terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

# Helm provider targets the k3s node's kubeconfig (not EKS).
provider "helm" {
  kubernetes {
    config_path = pathexpand("~/.kube/critical-hero-k3s.yaml")
  }
}

# Cloudflare hosts DNS for the domain (registrar may be elsewhere; just delegate NS to Cloudflare).
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

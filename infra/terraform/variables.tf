variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-2"
}

variable "project_name" {
  description = "Project name, used as a prefix for resource names"
  type        = string
  default     = "critical-hero"
}

variable "org_name" {
  description = "Organization name for the ECR repository prefix"
  type        = string
  default     = "eeeemune"
}

variable "ec2_instance_type" {
  description = "EC2 instance type for the k3s node"
  type        = string
  default     = "t3.xlarge"
}

variable "ssm_prefix" {
  description = "SSM Parameter Store path prefix holding lambda config/secrets (params managed out-of-band)"
  type        = string
  default     = "/critical-hero"
}

variable "domain" {
  description = "Root domain with a Route53 hosted zone in this account"
  type        = string
  default     = "critical-hero.com"
}

variable "mcp_host" {
  description = "FQDN for the mcp-server ingress"
  type        = string
  default     = "mcp.critical-hero.com"
}

variable "acme_email" {
  description = "Email for Let's Encrypt registration (used by the cert-manager ClusterIssuer)"
  type        = string
  default     = ""
}

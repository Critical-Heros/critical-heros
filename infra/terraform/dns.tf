# DNS records in Cloudflare. All unproxied (DNS only) so the A records resolve
# straight to the EIP; required for the cert-manager HTTP-01 challenge via Traefik.
resource "cloudflare_dns_record" "apex" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "A"
  content = aws_eip.k3s.public_ip
  ttl     = 300
  proxied = false
}

resource "cloudflare_dns_record" "mcp" {
  zone_id = var.cloudflare_zone_id
  name    = var.mcp_host
  type    = "A"
  content = aws_eip.k3s.public_ip
  ttl     = 300
  proxied = false
}

resource "cloudflare_dns_record" "grafana" {
  zone_id = var.cloudflare_zone_id
  name    = var.grafana_host
  type    = "A"
  content = aws_eip.k3s.public_ip
  ttl     = 300
  proxied = false
}

# cert-manager issues the Let's Encrypt cert for the ingresses (ClusterIssuer lives in the helm chart).
resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.16.2"
  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "crds.enabled"
    value = "true"
  }

  depends_on = [aws_instance.k3s]
}

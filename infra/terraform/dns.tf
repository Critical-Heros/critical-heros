data "aws_route53_zone" "main" {
  name = var.domain
}

resource "aws_route53_record" "mcp" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.mcp_host
  type    = "A"
  ttl     = 300
  records = [aws_eip.k3s.public_ip]
}

# cert-manager issues the Let's Encrypt cert for the mcp ingress (ClusterIssuer lives in the helm chart).
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

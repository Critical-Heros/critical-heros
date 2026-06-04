resource "helm_release" "prometheus" {
  name             = "prometheus"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
  version          = "86.1.0"
  namespace        = "monitoring"
  create_namespace = true

  set {
    name  = "prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues"
    value = "false"
  }

  set {
    name  = "prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues"
    value = "false"
  }

  set {
    name  = "prometheus.prometheusSpec.ruleSelectorNilUsesHelmValues"
    value = "false"
  }

  values = [<<-EOT
    prometheus:
      prometheusSpec:
        additionalScrapeConfigs:
          - job_name: otel-collector
            static_configs:
              - targets:
                  - otel-collector-opentelemetry-collector.monitoring:8889

    grafana:
      # Expose Grafana through the k3s Traefik ingress with a cert-manager TLS cert.
      # Reuses the letsencrypt-prod ClusterIssuer created by the critical-hero chart.
      grafana.ini:
        server:
          root_url: https://${var.grafana_host}
      ingress:
        enabled: true
        ingressClassName: traefik
        annotations:
          cert-manager.io/cluster-issuer: letsencrypt-prod
        hosts:
          - ${var.grafana_host}
        tls:
          - secretName: grafana-tls
            hosts:
              - ${var.grafana_host}
  EOT
  ]

  depends_on = [aws_instance.k3s]
}

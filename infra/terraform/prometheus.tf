resource "helm_release" "prometheus" {
  name             = "prometheus"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
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
  EOT
  ]

  depends_on = [aws_instance.k3s]
}

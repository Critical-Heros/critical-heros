resource "helm_release" "otel_operator" {
  name             = "otel-operator"
  repository       = "https://open-telemetry.github.io/opentelemetry-helm-charts"
  chart            = "opentelemetry-operator"
  namespace        = "monitoring"
  create_namespace = true

  set {
    name  = "admissionWebhooks.certManager.enabled"
    value = "false"
  }

  set {
    name  = "admissionWebhooks.autoGenerateCert.enabled"
    value = "true"
  }

  depends_on = [aws_instance.k3s]
}

resource "helm_release" "otel_collector" {
  name             = "otel-collector"
  repository       = "https://open-telemetry.github.io/opentelemetry-helm-charts"
  chart            = "opentelemetry-collector"
  namespace        = "monitoring"
  create_namespace = true

  values = [<<-EOT
    image:
      repository: otel/opentelemetry-collector-contrib

    mode: deployment

    config:
      receivers:
        otlp:
          protocols:
            grpc:
              endpoint: 0.0.0.0:4317
            http:
              endpoint: 0.0.0.0:4318

      processors:
        batch:
          timeout: 10s

      exporters:
        prometheus:
          endpoint: 0.0.0.0:8889
          namespace: otel
        debug:
          verbosity: basic

      connectors:
        spanmetrics:
          namespace: otel

      service:
        pipelines:
          traces:
            receivers: [otlp]
            processors: [batch]
            exporters: [debug, spanmetrics]
          metrics:
            receivers: [otlp, spanmetrics]
            processors: [batch]
            exporters: [prometheus]

    serviceMonitor:
      enabled: false

    podAnnotations:
      prometheus.io/scrape: "true"
      prometheus.io/port: "8889"
      prometheus.io/path: "/metrics"

    ports:
      otlp:
        enabled: true
        containerPort: 4317
        servicePort: 4317
        protocol: TCP
      otlp-http:
        enabled: true
        containerPort: 4318
        servicePort: 4318
        protocol: TCP
      prometheus:
        enabled: true
        containerPort: 8889
        servicePort: 8889
        protocol: TCP
  EOT
  ]

  depends_on = [aws_instance.k3s]
}

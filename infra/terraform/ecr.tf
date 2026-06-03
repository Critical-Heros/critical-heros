# One repository holds all service images, distinguished by tag
# (mcp-server, slack, github-webhook, slack-handler).
resource "aws_ecr_repository" "main" {
  name                 = "${var.org_name}/${var.project_name}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

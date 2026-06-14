data "aws_caller_identity" "current" {}

locals {
  ecr_registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

resource "aws_iam_role" "k3s" {
  name = "${var.project_name}-k3s"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "k3s_ecr" {
  role       = aws_iam_role.k3s.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "k3s_ssm" {
  role       = aws_iam_role.k3s.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "k3s" {
  name = "${var.project_name}-k3s"
  role = aws_iam_role.k3s.name
}

resource "aws_security_group" "k3s" {
  name        = "${var.project_name}-k3s"
  description = "k3s node for ${var.project_name}"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "MCP server"
    from_port   = 8401
    to_port     = 8401
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP (ACME)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "k3s API"
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# Allocate the EIP on its own so user_data can reference it (no hardcoded IP, no cycle).
resource "aws_eip" "k3s" {
  domain = "vpc"
}

resource "aws_instance" "k3s" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.ec2_instance_type
  iam_instance_profile   = aws_iam_instance_profile.k3s.name
  vpc_security_group_ids = [aws_security_group.k3s.id]

  root_block_device {
    volume_type = "gp3"
    volume_size = 30
  }

  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail

    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y cron unzip

    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
    unzip -q /tmp/awscliv2.zip -d /tmp
    /tmp/aws/install

    mkdir -p /home/ubuntu/.ssh
    cat >> /home/ubuntu/.ssh/authorized_keys <<'KEYS'
    ${fileexists("${path.module}/team-ssh-keys.txt") ? file("${path.module}/team-ssh-keys.txt") : ""}
    KEYS
    chown -R ubuntu:ubuntu /home/ubuntu/.ssh
    chmod 700 /home/ubuntu/.ssh
    chmod 600 /home/ubuntu/.ssh/authorized_keys

    snap install amazon-ssm-agent --classic || true
    systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service || true

    mkdir -p /etc/rancher/k3s
    cat > /usr/local/bin/refresh-ecr-creds.sh <<'EOF'
    #!/bin/bash
    set -e
    PW=$(aws ecr get-login-password --region ${var.aws_region})
    cat > /etc/rancher/k3s/registries.yaml <<INNER
    configs:
      "${local.ecr_registry}":
        auth:
          username: AWS
          password: $PW
    INNER
    EOF
    chmod +x /usr/local/bin/refresh-ecr-creds.sh
    /usr/local/bin/refresh-ecr-creds.sh

    curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644 --tls-san=${aws_eip.k3s.public_ip}" sh -

    mkdir -p /etc/cron.d
    echo "0 */8 * * * root /usr/local/bin/refresh-ecr-creds.sh" > /etc/cron.d/ecr-refresh || true
    systemctl enable --now cron || true
  EOT

  tags = { Name = "${var.project_name}-k3s" }

  # The ubuntu AMI data source uses most_recent, so it drifts whenever Canonical
  # publishes a new image. Ignore it so a routine apply never destroys/recreates
  # the whole cluster node. Bump deliberately (taint) when you actually want a new AMI.
  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_eip_association" "k3s" {
  instance_id   = aws_instance.k3s.id
  allocation_id = aws_eip.k3s.id
}

output "k3s_public_ip" {
  value = aws_eip.k3s.public_ip
}

output "k3s_instance_id" {
  value = aws_instance.k3s.id
}

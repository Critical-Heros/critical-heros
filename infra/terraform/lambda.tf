resource "aws_iam_role" "lambda" {
  name = "${var.project_name}-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Read config/secrets from SSM Parameter Store under the prefix (params managed out-of-band).
resource "aws_iam_role_policy" "lambda_ssm" {
  name = "${var.project_name}-lambda-ssm"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_prefix}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
      }
    ]
  })
}

locals {
  # function key -> image tag in the shared ECR repo
  lambda_functions = {
    github-webhook = "github-webhook"
    slack-handler  = "slack-handler"
  }
}

resource "aws_lambda_function" "fn" {
  for_each = local.lambda_functions

  function_name = "${var.project_name}-${each.key}"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.main.repository_url}:${each.value}"
  timeout       = 30
  memory_size   = 512

  environment {
    variables = {
      NODE_ENV   = "production"
      SSM_PREFIX = var.ssm_prefix
    }
  }
}

resource "aws_lambda_function_url" "fn" {
  for_each           = aws_lambda_function.fn
  function_name      = each.value.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["POST"]
    allow_headers = ["content-type"]
  }
}

resource "aws_lambda_permission" "fn_public" {
  for_each               = aws_lambda_function.fn
  statement_id           = "AllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = each.value.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

output "lambda_function_urls" {
  value = { for k, v in aws_lambda_function_url.fn : k => v.function_url }
}

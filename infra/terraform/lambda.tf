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

# Read every parameter under ssm_prefix (managed out-of-band) at apply time
# and inject them all into the lambdas' environment. Param name's last segment
# becomes the env var, e.g. /critical-hero/CLICKHOUSE_HOST -> CLICKHOUSE_HOST.
data "aws_ssm_parameters_by_path" "all" {
  path            = var.ssm_prefix
  recursive       = true
  with_decryption = true
}

locals {
  lambda_env = merge(
    {
      for i, name in data.aws_ssm_parameters_by_path.all.names :
      element(split("/", name), length(split("/", name)) - 1) => data.aws_ssm_parameters_by_path.all.values[i]
    },
    { NODE_ENV = "production" },
  )

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
  # PR review runs a multi-step agent (several LLM round-trips), so allow well beyond 30s.
  timeout       = 900
  memory_size   = 1024

  environment {
    variables = local.lambda_env
  }
}

resource "aws_lambda_function_url" "fn" {
  for_each           = aws_lambda_function.fn
  function_name      = each.value.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["POST", "GET"]
    allow_headers = ["*"]
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

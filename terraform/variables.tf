variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-southeast-1"
}

variable "instance_type" {
  description = "EC2 instance type. t3.small recommended (Postgres + Node together are tight on t2/t3.micro's 1GB RAM)."
  type        = string
  default     = "t3.small"
}

variable "key_pair_name" {
  description = "Name of an EXISTING EC2 key pair (create/import in the AWS console or `aws ec2 import-key-pair` first — Terraform does not generate it, so the private key is never written to state)."
  type        = string
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to reach port 22. Set to your own IP/32 — do not leave as 0.0.0.0/0 in real use."
  type        = string
  default     = "0.0.0.0/0"
}

variable "root_volume_gb" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 20
}

variable "enable_lab_nacl" {
  description = <<-EOT
    Opt-in: attach a custom, explicit-allow Network ACL to the instance's
    subnet (see nacl_lab.tf). Off by default — a NACL applies to the whole
    subnet, and if this is your account's default VPC, a mistake here can
    affect anything else running in that subnet, not just this instance.
    Safe to flip back to false any time; that reverts the subnet to the
    VPC's default (allow-all) NACL immediately via `terraform apply`.
  EOT
  type        = bool
  default     = false
}

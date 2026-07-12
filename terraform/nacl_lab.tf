# Optional lab: a custom Network ACL, to feel the difference between it and
# the security group in main.tf.
#
#   Security Group  — stateful, attached to the instance. Allow inbound :80,
#                      the response traffic back out is auto-allowed.
#   Network ACL     — stateless, attached to the whole SUBNET. You must
#                      allow BOTH directions explicitly, including the
#                      ephemeral high ports (1024-65535) that responses and
#                      the instance's own outbound requests (apt, docker
#                      pull, DuckDNS update, git pull) come back through.
#                      Forget the ephemeral range and everything looks
#                      "allowed" on the way out but the reply never comes
#                      back in — a classic NACL gotcha.
#
# Disabled by default (see var.enable_lab_nacl in variables.tf). Enable with:
#   terraform apply -var="enable_lab_nacl=true" -var="key_pair_name=..." -var="ssh_allowed_cidr=..."
#
# Locked yourself out? terraform apply -var="enable_lab_nacl=false" ... reverts
# the subnet to the VPC's default (allow-all) NACL — this runs from your
# laptop straight to the AWS API, so it works even if the broken NACL has cut
# off SSH to the instance itself.

resource "aws_network_acl" "lab" {
  count = var.enable_lab_nacl ? 1 : 0

  vpc_id     = data.aws_vpc.default.id
  subnet_ids = [sort(data.aws_subnets.default.ids)[0]]

  # --- inbound ---
  ingress {
    rule_no    = 100
    protocol   = "tcp"
    action     = "allow"
    cidr_block = var.ssh_allowed_cidr
    from_port  = 22
    to_port    = 22
  }
  ingress {
    rule_no    = 110
    protocol   = "tcp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 80
    to_port    = 80
  }
  ingress {
    rule_no    = 120
    protocol   = "tcp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 443
    to_port    = 443
  }
  # Return traffic for connections the instance itself initiates outbound
  # (apt-get, docker pull, npm/GitHub, DuckDNS update, Let's Encrypt) lands
  # on an ephemeral port here — without this rule those all "hang" with no
  # visible error, because the request leaves fine but the reply is dropped.
  ingress {
    rule_no    = 130
    protocol   = "tcp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 1024
    to_port    = 65535
  }
  ingress {
    rule_no    = 140
    protocol   = "udp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 1024
    to_port    = 65535
  }

  # --- outbound ---
  egress {
    rule_no    = 100
    protocol   = "tcp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 80
    to_port    = 80
  }
  egress {
    rule_no    = 110
    protocol   = "tcp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 443
    to_port    = 443
  }
  # DNS resolution (VPC's Amazon-provided resolver) — dropped silently
  # without this, which looks exactly like a network outage from inside
  # the box ("can't resolve github.com") even though :443 egress is open.
  egress {
    rule_no    = 120
    protocol   = "udp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 53
    to_port    = 53
  }
  egress {
    rule_no    = 130
    protocol   = "tcp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 53
    to_port    = 53
  }
  # Responses back to whoever connected in on 22/80/443
  egress {
    rule_no    = 140
    protocol   = "tcp"
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 1024
    to_port    = 65535
  }

  tags = { Name = "pfms-nacl-lab" }
}

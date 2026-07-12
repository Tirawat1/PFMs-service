output "instance_id" {
  value = aws_instance.pfms.id
}

output "public_ip" {
  description = "Static Elastic IP — point your DuckDNS record here"
  value       = aws_eip.pfms.public_ip
}

output "ssh_command" {
  value = "ssh -i /path/to/${var.key_pair_name}.pem ubuntu@${aws_eip.pfms.public_ip}"
}

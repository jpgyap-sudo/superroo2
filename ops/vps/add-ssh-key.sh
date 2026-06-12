#!/bin/bash
# Run this ON THE VPS to add the local machine's SSH key.
# Paste this into your VPS console (DigitalOcean/panel/Tailscale terminal).

mkdir -p /root/.ssh
chmod 700 /root/.ssh

cat >> /root/.ssh/authorized_keys << 'PUBKEY'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDbavtE/+S8MGZZU4n8gRz0C8bArDBtPVprkjLlqwptl superroo-vps-deploy
PUBKEY

chmod 600 /root/.ssh/authorized_keys
echo "✅ SSH key added. You can now SSH from your local machine with:"
echo "   ssh -i C:/Users/user/.ssh/id_superroo_vps root@100.64.175.88"

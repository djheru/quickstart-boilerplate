#!/bin/bash
set -eu

GREEN_ON='[0;32m'
RED_ON='[0;31m'
COLOR_OFF='[0m'

if [[ $# -lt 2 ]] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} Usage: yarn db-tunnel env ./path/to/private/key\n\n"
  exit 1
fi

# Set vars
env="$1"
db_stack="quickstart-$env"
vpc_stack="quickstart-$env"
ssh_key="$2"
db_identifier="$db_stack"-db-id
secret_id="$db_stack"-db-secret
bastion_id="$vpc_stack"-bastion-host

if [[ ! -f "$ssh_key" ]] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} SSH Key not found. Usage: yarn db-tunnel env ./path/to/private/key\n\n"
  exit 1
fi

if [[ ! -f "$ssh_key.pub" ]] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} SSH Public Key not found. Usage: yarn db-tunnel env ./path/to/private/key\n\n"
  exit 1
fi

echo "${GREEN_ON}✓${COLOR_OFF} Retrieving RDS DB Secret"
export RDS_CREDENTIALS=$(aws secretsmanager get-secret-value \
  --secret-id "$secret_id" \
  --query 'SecretString')
if [ -z "$RDS_CREDENTIALS" ] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} Unable to determine the DB connection details"
  exit 1
fi
user=$(node -p "JSON.parse($RDS_CREDENTIALS).username")
pass=$(node -p "JSON.parse($RDS_CREDENTIALS).password")
host=$(node -p "JSON.parse($RDS_CREDENTIALS).host")
port=$(node -p "JSON.parse($RDS_CREDENTIALS).port")
dbname=$(node -p "JSON.parse($RDS_CREDENTIALS).dbname")


export INSTANCE_DATA=$(aws ec2 describe-instances \
  --filters "Name=tag-value,Values=$bastion_id" \
  --query 'Reservations[0].Instances[0]')

echo "${GREEN_ON}✓${COLOR_OFF} Retrieving the Bastion Host Instance IP Address"
export BASTION_IP_ADDRESS=$(node -p "($INSTANCE_DATA).PublicIpAddress")
if [ -z "$BASTION_IP_ADDRESS" ] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} Unable to determine the Bastion Host IP Address"
  exit 1
fi

echo "${GREEN_ON}✓${COLOR_OFF} Retrieving the Bastion Host Instance ID"
export INSTANCE_ID=$(node -p "($INSTANCE_DATA).InstanceId")
if [ -z "$INSTANCE_ID" ] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} Unable to determine the Bastion Host Instance ID"
  exit 1
fi

echo "${GREEN_ON}✓${COLOR_OFF} Retrieving the Bastion Host Instance Availability Zone"
export INSTANCE_AZ=$(node -p "($INSTANCE_DATA).Placement.AvailabilityZone")
if [ -z "$INSTANCE_AZ" ] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} Unable to determine the Bastion Host AZ"
  exit 1
fi

echo "${GREEN_ON}✓${COLOR_OFF} Retrieving the Bastion Host Region"
export INSTANCE_REGION=$(echo $INSTANCE_AZ | sed 's/.$//')
if [ -z "$BASTION_IP_ADDRESS" ] ; then
  echo -e "\n\n${RED_ON}✘ Error!${COLOR_OFF} Unable to determine the Bastion Host Region"
  exit 1
fi

echo "${GREEN_ON}✓${COLOR_OFF} Transferring the SSH key to the Bastion Host"
aws ec2-instance-connect send-ssh-public-key \
  --region $INSTANCE_REGION \
  --instance-id $INSTANCE_ID \
  --availability-zone $INSTANCE_AZ \
  --instance-os-user ec2-user \
  --ssh-public-key file://$ssh_key.pub

echo -e "\n"
echo "${GREEN_ON}You may now connect to the remote database using SSH tunneling${COLOR_OFF}"
echo -e "\n"

echo "RDS HOST: ${GREEN_ON}$host${COLOR_OFF}"
echo "RDS USERNAME: ${GREEN_ON}$user${COLOR_OFF}"
echo "RDS PASSWORD: ${GREEN_ON}$pass${COLOR_OFF}"
echo "RDS PORT: ${GREEN_ON}$port${COLOR_OFF}"
echo "RDS DB NAME: ${GREEN_ON}$dbname${COLOR_OFF}"
echo -e "\n"

echo "SSH HOST: ${GREEN_ON}$BASTION_IP_ADDRESS${COLOR_OFF}"
echo "SSH USER: ${GREEN_ON}ec2-user${COLOR_OFF}"
echo "SSH KEY: ${GREEN_ON}$ssh_key${COLOR_OFF}"
echo -e "\n"

echo "Opening a tunnel"
echo "You can now connect using the RDS username and password"
echo "Use \"localhost\" as the DB host 😉"
echo "Press ${GREEN_ON}CTRL+C${COLOR_OFF} to close the tunnel"
echo -e "\n"

ssh -N -L 5432:$host:5432 ec2-user@$BASTION_IP_ADDRESS -i $ssh_key
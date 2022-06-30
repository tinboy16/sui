// Copyright (c) 2022, Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use sui_config::ValidatorInfo;
use sui_node::SuiNode;
use sui_types::crypto::get_key_pair;
use sui_types::messages::ExecutionStatus;
use sui_types::messages::{CallArg, ObjectArg};
use test_utils::authority::test_authority_configs;
use test_utils::messages::move_transaction;
use test_utils::objects::test_gas_objects;
use test_utils::transaction::submit_single_owner_transaction;

#[tokio::test]
async fn test_epoch_change_committee_updates() {
    let configs = test_authority_configs();
    let validator_info = configs.validator_set();
    let mut gas_objects = test_gas_objects();
    let mut states = Vec::new();
    let mut handles = Vec::new();
    for validator in configs.validator_configs() {
        let node = SuiNode::start(validator).await.unwrap();
        let state = node.state();
        for gas in gas_objects.clone() {
            state.insert_genesis_object(gas).await;
        }
        //node.active().unwrap().start_epoch_change();
        states.push(state);
        handles.push(node);
    }

    let _sui_system_state = states[0].get_sui_system_state_object().await.unwrap();

    let new_validator = get_new_validator();
    let package = states[0].get_framework_object_ref().await.unwrap();

    let validator_tx = move_transaction(
        gas_objects.pop().unwrap(),
        "sui_system",
        "request_add_validator",
        package,
        vec![
            CallArg::Object(ObjectArg::ImmOrOwnedObject()),
            CallArg::Pure(bcs::to_bytes(&new_validator.sui_address()).unwrap()),
            CallArg::Pure(bcs::to_bytes(&new_validator.public_key()).unwrap()),
            CallArg::Pure(
                bcs::to_bytes(format!("Validator{}", new_validator.sui_address()).as_bytes())
                    .unwrap(),
            ),
            CallArg::Pure(bcs::to_bytes(&new_validator.network_address).unwrap()),
            CallArg::Pure(bcs::to_bytes(&new_validator.stake).unwrap()),
        ],
    );
    let validator_effects = submit_single_owner_transaction(validator_tx, validator_info).await;
    let _k = 1;

    assert!(matches!(
        validator_effects.status,
        ExecutionStatus::Success { .. }
    ));

    let _transaction = move_transaction(
        gas_objects.pop().unwrap(),
        "sui_system",
        "request_add_validator",
        gas_objects.pop().unwrap().compute_object_reference(),
        vec![], // TODO
    );
    // todo: get sui system state and confirm it matches network info
    assert_eq!(1, 1);
}

pub fn get_new_validator() -> ValidatorInfo {
    let keypair = get_key_pair();
    ValidatorInfo {
        public_key: *keypair.1.public_key_bytes(),
        stake: 1,
        delegation: 0,
        network_address: sui_config::utils::new_network_address(),
    }
}

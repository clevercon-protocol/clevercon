#![cfg(test)]
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::{Registry, RegistryClient, RegistryError};

fn setup() -> (Env, RegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Registry, ());
    let client = RegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.init(&admin);
    (env, client, admin)
}

fn hash(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

#[test]
fn register_get_and_update_manifest() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = String::from_str(&env, "oracle-1");

    client.register(&owner, &id, &hash(&env, 0xAA), &payee);
    let rec = client.get(&id);
    assert_eq!(rec.owner, owner);
    assert_eq!(rec.manifest_hash, hash(&env, 0xAA));
    assert_eq!(rec.total_jobs, 0);

    client.set_manifest(&owner, &id, &hash(&env, 0xBB));
    assert_eq!(client.get(&id).manifest_hash, hash(&env, 0xBB));
}

#[test]
fn non_owner_cannot_update() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = String::from_str(&env, "oracle-1");
    client.register(&owner, &id, &hash(&env, 0xAA), &payee);

    let res = client.try_set_manifest(&attacker, &id, &hash(&env, 0xCC));
    assert_eq!(res, Err(Ok(RegistryError::Unauthorized)));
    // Re-registering someone else's id is also rejected.
    let res2 = client.try_register(&attacker, &id, &hash(&env, 0xCC), &payee);
    assert_eq!(res2, Err(Ok(RegistryError::Unauthorized)));
}

#[test]
fn admin_records_reputation_provider_cannot() {
    let (env, client, admin) = setup();
    let owner = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = String::from_str(&env, "oracle-1");
    client.register(&owner, &id, &hash(&env, 0xAA), &payee);

    client.record_job(&admin, &id, &true, &90);
    client.record_job(&admin, &id, &false, &40);
    let rec = client.get(&id);
    assert_eq!(rec.total_jobs, 2);
    assert_eq!(rec.successful_jobs, 1);
    assert_eq!(rec.quality_sum, 130);

    // A non-admin (the owner) cannot write reputation.
    let res = client.try_record_job(&owner, &id, &true, &100);
    assert_eq!(res, Err(Ok(RegistryError::Unauthorized)));
    // Quality out of range is rejected.
    let bad = client.try_record_job(&admin, &id, &true, &101);
    assert_eq!(bad, Err(Ok(RegistryError::InvalidQuality)));
}

#[test]
fn deregister_removes_and_missing_is_not_found() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = String::from_str(&env, "oracle-1");
    client.register(&owner, &id, &hash(&env, 0xAA), &payee);

    client.deregister(&owner, &id);
    // try_get's Ok payload is AgentRecord (no Debug), so compare only the error.
    assert_eq!(client.try_get(&id).err(), Some(Ok(RegistryError::NotFound)));
}

#[test]
fn re_register_by_owner_keeps_reputation() {
    let (env, client, admin) = setup();
    let owner = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = String::from_str(&env, "oracle-1");
    client.register(&owner, &id, &hash(&env, 0xAA), &payee);
    client.record_job(&admin, &id, &true, &80);

    // Re-register (e.g. new endpoint) keeps the accumulated reputation.
    client.register(&owner, &id, &hash(&env, 0xDD), &payee);
    let rec = client.get(&id);
    assert_eq!(rec.total_jobs, 1);
    assert_eq!(rec.manifest_hash, hash(&env, 0xDD));
}

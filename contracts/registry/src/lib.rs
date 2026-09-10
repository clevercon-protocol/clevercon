#![no_std]
//! # `registry` — on-chain agent/service registry for CleverCon
//!
//! Stores, per `agent_id`, a tamper-evident **manifest hash** (what the provider
//! published: name, endpoint, pricing, capabilities) plus an on-chain
//! **reputation** snapshot (jobs + score). The off-chain registry/API becomes a
//! cache over this: anyone can verify a provider's advertised manifest and
//! reputation against the chain instead of trusting a server.
//!
//! ## Entrypoints
//! | Function | Who | Description |
//! |---|---|---|
//! | `init(admin)` | once | set the admin (may update reputation) |
//! | `register(owner, agent_id, manifest_hash, payee)` | provider | register/replace own listing |
//! | `set_manifest(owner, agent_id, manifest_hash)` | owner | update the manifest hash |
//! | `record_job(admin, agent_id, success, quality)` | admin | fold one job outcome into reputation |
//! | `get(agent_id)` | view | the full on-chain record |
//! | `deregister(owner, agent_id)` | owner | remove a listing |
//!
//! Ownership: a listing is owned by the `owner` address that registered it;
//! only that owner can update or remove it (`owner.require_auth()`). Reputation
//! is written only by the admin (the platform that observes job outcomes), so a
//! provider cannot inflate its own score.

extern crate alloc;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, String};

#[contracttype]
#[derive(Clone)]
pub struct AgentRecord {
    pub owner: Address,
    pub manifest_hash: BytesN<32>,
    pub payee: Address,
    pub total_jobs: u32,
    pub successful_jobs: u32,
    /// Sum of per-job quality (0..=100); average = quality_sum / total_jobs.
    pub quality_sum: u64,
    pub registered_ledger: u32,
    pub updated_ledger: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Agent(String), // agent_id -> AgentRecord
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    NotFound = 4,
    InvalidQuality = 5,
}

#[contract]
pub struct Registry;

#[contractimpl]
impl Registry {
    /// One-time init: store the admin that may record reputation.
    pub fn init(env: Env, admin: Address) -> Result<(), RegistryError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Register (or replace) a listing owned by `owner`. Reputation is reset only
    /// on a brand-new listing; re-registering an existing one keeps its history
    /// (only the owner may do so).
    pub fn register(
        env: Env,
        owner: Address,
        agent_id: String,
        manifest_hash: BytesN<32>,
        payee: Address,
    ) -> Result<(), RegistryError> {
        owner.require_auth();
        let key = DataKey::Agent(agent_id);
        let ledger = env.ledger().sequence();

        let record = match env.storage().persistent().get::<_, AgentRecord>(&key) {
            Some(existing) => {
                if existing.owner != owner {
                    return Err(RegistryError::Unauthorized);
                }
                AgentRecord {
                    manifest_hash,
                    payee,
                    updated_ledger: ledger,
                    ..existing
                }
            }
            None => AgentRecord {
                owner: owner.clone(),
                manifest_hash,
                payee,
                total_jobs: 0,
                successful_jobs: 0,
                quality_sum: 0,
                registered_ledger: ledger,
                updated_ledger: ledger,
            },
        };
        env.storage().persistent().set(&key, &record);
        Ok(())
    }

    /// Update the manifest hash for a listing (owner only).
    pub fn set_manifest(
        env: Env,
        owner: Address,
        agent_id: String,
        manifest_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        owner.require_auth();
        let key = DataKey::Agent(agent_id);
        let mut record: AgentRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::NotFound)?;
        if record.owner != owner {
            return Err(RegistryError::Unauthorized);
        }
        record.manifest_hash = manifest_hash;
        record.updated_ledger = env.ledger().sequence();
        env.storage().persistent().set(&key, &record);
        Ok(())
    }

    /// Fold one job outcome into a listing's reputation. Admin-only, so a
    /// provider cannot inflate its own score. `quality` is 0..=100.
    pub fn record_job(
        env: Env,
        admin: Address,
        agent_id: String,
        success: bool,
        quality: u32,
    ) -> Result<(), RegistryError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        if stored_admin != admin {
            return Err(RegistryError::Unauthorized);
        }
        if quality > 100 {
            return Err(RegistryError::InvalidQuality);
        }
        let key = DataKey::Agent(agent_id);
        let mut record: AgentRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::NotFound)?;
        record.total_jobs += 1;
        if success {
            record.successful_jobs += 1;
        }
        record.quality_sum += quality as u64;
        record.updated_ledger = env.ledger().sequence();
        env.storage().persistent().set(&key, &record);
        Ok(())
    }

    /// The full on-chain record for an agent_id.
    pub fn get(env: Env, agent_id: String) -> Result<AgentRecord, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(agent_id))
            .ok_or(RegistryError::NotFound)
    }

    /// Remove a listing (owner only).
    pub fn deregister(env: Env, owner: Address, agent_id: String) -> Result<(), RegistryError> {
        owner.require_auth();
        let key = DataKey::Agent(agent_id);
        let record: AgentRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::NotFound)?;
        if record.owner != owner {
            return Err(RegistryError::Unauthorized);
        }
        env.storage().persistent().remove(&key);
        Ok(())
    }
}

#[cfg(test)]
mod test;

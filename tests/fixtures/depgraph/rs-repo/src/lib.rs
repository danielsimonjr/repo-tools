//! The crate root.

pub mod model;
pub mod net;
mod util;

/// Runs the crate.
pub fn run() -> u8 {
    net::send(util::one())
}

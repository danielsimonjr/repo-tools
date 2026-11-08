mod wire;

/// Sends a byte.
pub fn send(b: u8) -> u8 {
    wire::put(b)
}

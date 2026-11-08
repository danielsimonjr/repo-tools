#[derive(Debug)]
// why the next attribute exists
#[serde(rename_all = "camelCase")]
pub struct Foo;

/// Sends a byte.
pub fn send(b: u8) -> u8 {
    b
}

pub fn put(a: u8, b: u8) -> u8 {
    a + b
}

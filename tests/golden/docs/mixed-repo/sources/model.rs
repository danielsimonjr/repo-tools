/// TODO: state what this does, in one active-voice sentence.
#[derive(Debug)]
// why the next attribute exists
#[serde(rename_all = "camelCase")]
pub struct Foo;

/// Sends a byte.
pub fn send(b: u8) -> u8 {
    b
}

/// TODO: state what this does, in one active-voice sentence.
///
/// # Arguments
///
/// * `a` - TODO: state what it is. Do not repeat the type.
/// * `b` - TODO: state what it is. Do not repeat the type.
///
/// # Returns
///
/// TODO: state what the caller gets back.
pub fn put(a: u8, b: u8) -> u8 {
    a + b
}

#[derive(Debug)]
// why the next attribute exists
#[serde(rename_all = "camelCase")]
pub struct Foo;

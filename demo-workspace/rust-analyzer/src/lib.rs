pub struct CodeGraph {
    pub node_count: usize,
}

impl CodeGraph {
    pub fn new(count: usize) -> Self {
        CodeGraph { node_count: count }
    }

    pub fn render_nodes(&self) {
        println!("Rendering {} nodes in Rust graph", self.node_count);
    }
}

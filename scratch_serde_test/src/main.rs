fn main() {
    let v: Vec<f32> = vec![1.0, -0.000001234, 3.141592653589793, 0.0, -1.5, 0.123456789];
    let serde_out = serde_json::to_string(&v).unwrap();
    println!("serde: {}", serde_out);
    let mut s = String::from("[");
    for (i, f) in v.iter().enumerate() {
        if i > 0 { s.push(','); }
        s.push_str(&format!("{:.6}", f));
    }
    s.push(']');
    println!("manual: {}", s);
}

async function testSend(): Promise<void> {
  try {
    const response = await fetch(`/api/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify([]),
    })

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`)
    }

    const result = await response.json()
    console.log(result)
  } catch (error) {
    console.error("Error connecting to backend API:", error)
  }
}

export default testSend

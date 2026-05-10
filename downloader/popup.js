document.addEventListener('DOMContentLoaded', () => {
  // Fetch the saved request from background.js
  chrome.storage.local.get(['lastVideoRequest'], (result) => {
    if (result.lastVideoRequest) {
      const req = result.lastVideoRequest;
      document.getElementById('status').innerText = "Video intercepted successfully!";
      document.getElementById('status').style.color = "#00ff66";
      
      // Clear the notification badge
      chrome.action.setBadgeText({ text: "" });

      // Build the cURL command
      let curl = `curl "${req.url}"`;
      if (req.headers) {
        req.headers.forEach(h => {
          // Escape any double quotes in the headers
          let val = h.value.replace(/"/g, '\\"');
          curl += ` -H "${h.name}: ${val}"`;
        });
      }
      
      // Give the output file a unique timestamped name
      curl += ` --output "recording_${Date.now()}.mp4"`;

      document.getElementById('curlCommand').value = curl;
    }
  });

  // Handle the Copy Button
  document.getElementById('copyBtn').addEventListener('click', () => {
    const text = document.getElementById('curlCommand').value;
    if (!text) return;
    
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copyBtn');
      btn.innerText = "Copied to Clipboard!";
      btn.style.background = "#00cc52";
      
      setTimeout(() => { 
        btn.innerText = "Copy cURL Command"; 
        btn.style.background = "#2d8cff";
      }, 2000);
    });
  });
});

// --- NEW: Handle the Send to Node Button ---
document.getElementById('nodeBtn').addEventListener('click', () => {
  const text = document.getElementById('curlCommand').value;
  if (!text) return;

  const btn = document.getElementById('nodeBtn');
  btn.innerText = "Sending...";

  fetch('http://localhost:3052/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: text })
  })
  .then(response => {
    if (response.ok) {
      btn.innerText = "Downloading in background!";
      btn.style.background = "#00cc52";
    } else {
      throw new Error('Server rejected');
    }
  })
  .catch(err => {
    alert("Could not connect! Is your node_server.js running?");
    btn.innerText = "Download";
  });
});
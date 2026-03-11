async function main() {
    let cookie = '';

    // Login
    const loginRes = await fetch('http://127.0.0.1:3005/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });

    if (!loginRes.ok) throw new Error('Login failed');
    cookie = loginRes.headers.get('set-cookie');
    console.log("Logged in successfully. Cookie:", cookie);

    // Trigger job
    const jobRes = await fetch('http://127.0.0.1:3005/api/jobs', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': cookie
        },
        body: JSON.stringify({
            country: 'United States',
            cities: ['Austin'],
            niches: ['plumber'],
            includeGoogleMaps: false
        })
    });

    if (!jobRes.ok) throw new Error('Job trigger failed');
    const jobData = await jobRes.json();
    console.log("Job started:", jobData);

    // Poll the history for status
    const jobId = jobData.jobId;
    let isDone = false;

    while (!isDone) {
        await new Promise(r => setTimeout(r, 2000));

        const histRes = await fetch('http://127.0.0.1:3005/api/history', {
            headers: { 'Cookie': cookie }
        });
        const histData = await histRes.json();
        const myJob = histData.find(j => j.id === jobId);

        if (myJob) {
            console.log(`Job status: ${myJob.status}, progress: ${myJob.progress}%`);
            if (myJob.status !== "running" && myJob.status !== "queued") {
                isDone = true;
                console.log("Final Job Status:", myJob.status);
                console.log("Files generated:", myJob.files);
            }
        } else {
            console.log("Job not found in history yet.");
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

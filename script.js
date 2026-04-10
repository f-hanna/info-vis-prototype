        // State variables
        let stimulusOnset;
        let selectedAnswer = null;
        let correctAnswer = 'C'; // Example correct answer
        let trialData = {};

        // Mock data for a "Position x Color" dot graph condition
        const data = [
            { category: 'A', value: 30 },
            { category: 'B', value: 50 },
            { category: 'C', value: 90 },
            { category: 'D', value: 20 }
        ];

        function renderVisualization() {
            // Clear previous
            d3.select("#viz-container").selectAll("*").remove();

            const margin = { top: 20, right: 20, bottom: 40, left: 40 };
            const width = 500 - margin.left - margin.right;
            const height = 350 - margin.top - margin.bottom;

            const svg = d3.select("#viz-container")
                .append("svg")
                .attr("width", width + margin.left + margin.right)
                .attr("height", height + margin.top + margin.bottom)
                .append("g")
                .attr("transform", `translate(${margin.left},${margin.top})`);

            // Scales
            const x = d3.scaleBand().domain(data.map(d => d.category)).range([0, width]).padding(1);
            const y = d3.scaleLinear().domain([0, 100]).range([height, 0]);

            // Color encoding (Redundant to position)
            const color = d3.scaleSequential(d3.interpolateBlues).domain([0, 100]);

            // Axes
            svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));
            svg.append("g").call(d3.axisLeft(y));

            // Dots (Position x Color encoding)
            svg.selectAll(".dot")
                .data(data)
                .enter()
                .append("circle")
                .attr("cx", d => x(d.category))
                .attr("cy", d => y(d.value))
                .attr("r", 8)
                .style("fill", d => color(d.value));

            // Optional: Toggle this class based on experimental condition
            // document.getElementById("viz-container").classList.add("obscured-vision");

            // START TIMER
            stimulusOnset = performance.now();
        }

        function selectAnswer(answer) {
            selectedAnswer = answer;
            let completionTime = performance.now();

            // Calculate speed in seconds
            trialData.speedInSeconds = (completionTime - stimulusOnset) / 1000;
            trialData.isCorrect = (selectedAnswer === correctAnswer);

            // Hide answers, show Likert scale
            document.getElementById("answers").style.display = "none";
            document.getElementById("likert").style.display = "block";
        }

        function submitTrial() {
            const difficultyInput = document.querySelector('input[name="difficulty"]:checked');
            if (!difficultyInput) {
                alert("Please rate the task difficulty before proceeding.");
                return;
            }

            trialData.perceivedDifficulty = parseInt(difficultyInput.value);

            // Log the JSON data payload for this trial
            console.log("Trial Complete Data JSON:", JSON.stringify(trialData));

            // Reset for next trial
            document.getElementById("likert").style.display = "none";
            document.getElementById("answers").style.display = "block";

            // Uncheck radios
            document.querySelectorAll('input[name="difficulty"]').forEach(r => r.checked = false);

            // In a real app, you would append `trialData` to an array and render the next trial here
            alert(`Trial logged! Speed: ${trialData.speedInSeconds.toFixed(2)}s | Correct: ${trialData.isCorrect} | Difficulty: ${trialData.perceivedDifficulty}`);
        }

        // Initialize first trial on load
        window.onload = renderVisualization;

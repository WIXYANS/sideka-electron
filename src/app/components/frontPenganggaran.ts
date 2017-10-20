import { Component, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';

import SiskeudesService from '../stores/siskeudesService';
import SettingsService from '../stores/settingsService';
import { Router } from '@angular/router';

@Component({
    selector: 'front-penganggaran',
    templateUrl: '../templates/frontPenganggaran.html',
    styles: [`
        :host {
            display: flex;
        }
    `],
})

export default class FrontPenganggaranComponent {
    settingsSubscription: Subscription;
    siskeudesMessage: string;
    kodeDesa: string;
    sumAnggaranRAB: any[] = [];

    constructor(
        private zone: NgZone,
        private siskeudesService: SiskeudesService,
        private settingsService: SettingsService,
        private router: Router
    ) {
    }

    ngOnInit(): void {
        this.siskeudesMessage = this.siskeudesService.getSiskeudesMessage();
        this.settingsSubscription = this.settingsService.getAll().subscribe(settings => { 
            this.kodeDesa = settings.kodeDesa;
            this.getRAB();
        });        
    }

    ngOnDestroy(): void {
        this.settingsSubscription.unsubscribe();
    }

    getRAB(): void {
        if (this.siskeudesMessage)
            return;

        this.siskeudesService.getSumAnggaranRAB(this.kodeDesa, data => {
            this.zone.run(() => {
                let uniqueYears = [];

                data.forEach(content => {
                    let isUniqueYear = uniqueYears.map(c => c['year']).indexOf(content['Tahun']);
                    let isUniqueDesa = uniqueYears.map(c => c['kd_desa']).indexOf(content['Kd_Desa']);

                    if (isUniqueDesa == -1 && isUniqueYear == -1 || isUniqueDesa == -1 && isUniqueYear != -1) {
                        uniqueYears.push({
                            year: content['Tahun'],
                            kd_desa: content['Kd_Desa'],
                        })
                    }
                })

                uniqueYears.forEach(item => {
                    let content = data.filter(c => c.Tahun == item.year && c.Kd_Desa == item.kd_desa)
                    this.sumAnggaranRAB.push({
                        year: item.year,
                        kd_desa: item.kd_desa,
                        data: content
                    })
                })
                if(this.sumAnggaranRAB.length == 1){
                    let rab = this.sumAnggaranRAB[0];
                    this.router.navigate(['/penganggaran'], { queryParams: { 
                        year: rab.year, 
                        kd_desa: rab.kd_desa, 
                    } });``
                }
            });
        });
    }
}
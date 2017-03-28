var { Component, ApplicationRef } = require('@angular/core');
var path = require('path');
var fs = require('fs');
var $ = require('jquery');
var { remote, app, shell } = require('electron'); // native electron module
var jetpack = require('fs-jetpack'); // module loaded from npm
var Docxtemplater = require('docxtemplater');
var Handsontable = require('./handsontablep/dist/handsontable.full.js');
var expressions = require('angular-expressions');
var ImageModule = require('docxtemplater-image-module');

import { pendudukImporterConfig, Importer } from '../helpers/importer';
import { exportPenduduk } from '../helpers/exporter';
import dataapi from '../stores/dataapi';
import v2Dataapi from "../stores/v2Dataapi";
import schemas from '../schemas';
import { initializeTableSearch, initializeTableCount, initializeTableSelected } from '../helpers/table';
import createPrintVars from '../helpers/printvars';
import diffProps from '../helpers/diff';

window['jQuery'] = $;
require('./node_modules/bootstrap/dist/js/bootstrap.js');

var app = remote.app;
var hot;
var sheetContainer;
var emptyContainer;
var resultBefore=[];
var app = remote.app;
var appDir = jetpack.cwd(app.getAppPath());
var DATA_DIR = app.getPath("userData");
var CONTENT_DIR = path.join(DATA_DIR, "contents");

window['app'] = app;

var init = () => {    
    $(".titlebar").addClass("blue");
    sheetContainer = document.getElementById('sheet');
    emptyContainer = document.getElementById('empty');
    window['hot'] = hot = new Handsontable(sheetContainer, {
        data: [],
        topOverlay: 34,

        rowHeaders: true,
        colHeaders: schemas.getHeader(schemas.penduduk),
        columns: schemas.getColumns(schemas.penduduk),

        colWidths: schemas.getColWidths(schemas.penduduk),
        rowHeights: 23,
        
        columnSorting: true,
        sortIndicator: true,
        hiddenColumns: {indicators: true},
        
        renderAllRows: false,
        outsideClickDeselects: false,
        autoColumnSize: false,
        search: true,
        schemaFilters: true,
        contextMenu: ['undo', 'redo', 'row_above', 'remove_row'],
        dropdownMenu: ['filter_by_condition', 'filter_action_bar']
    });
    
    var spanSelected = $("#span-selected")[0];
    initializeTableSelected(hot, 1, spanSelected);
    
    var spanCount = $("#span-count")[0];
    initializeTableCount(hot, spanCount);

    window.addEventListener('resize', function(e){
        hot.render();
    })
};
var showColumns = [      
        [],
        ["nik","nama_penduduk","tempat_lahir","tanggal_lahir","jenis_kelamin","pekerjaan","kewarganegaraan","rt","rw","nama_dusun","agama","alamat_jalan"],
        ["nik","nama_penduduk","no_telepon","email","rt","rw","nama_dusun","alamat_jalan"],
        ["nik","nama_penduduk","tempat_lahir","tanggal_lahir","jenis_kelamin","nama_ayah","nama_ibu","hubungan_keluarga","no_kk"],
        ["nik","nama_penduduk","kompetensi","pendidikan","pekerjaan","pekerjaan_ped"]
    ];

var spliceArray = function(fields, showColumns){
    var result=[];
    for(var i=0;i!=fields.length;i++){
        var index = showColumns.indexOf(fields[i]);
        if (index == -1) result.push(i);
    }
    return result;
}

@Component({
    selector: 'penduduk',
    templateUrl: 'templates/penduduk.html'
})
class PendudukComponent extends diffProps{
    appRef: any;
    tableSearcher: any;
    importer: any;
    loaded: boolean;
    savingMessage: string;
    printSurat: any;
    isFileMenuShown = false;
    maxPaging: number;
    page: number;
    completeData: any[];

    constructor(appRef) {
        super();
        this.appRef = appRef;
        this.printSurat = false;
        this.maxPaging = 0;
        this.page = 1;
    }

    ngOnInit(){
        $("title").html("Data Penduduk - " +dataapi.getActiveAuth()['desa_name']);

        init(); 
        
        let dataFile = path.join(DATA_DIR, "setting.json");

        if(!jetpack.exists(dataFile))
            return null;

        let data = JSON.parse(jetpack.read(dataFile));
        this.maxPaging = data.maxPaging ? data.maxPaging : 0;
        
        var inputSearch = document.getElementById("input-search");
        this.tableSearcher = initializeTableSearch(hot, document, inputSearch, null);
        
        this.hot = window['hot'];
        this.importer = new Importer(pendudukImporterConfig);
        var ctrl = this;
    
        function keyup(e) {
            //ctrl+s
            if (e.ctrlKey && e.keyCode == 83){
                ctrl.openSaveDiffDialog("penduduk");
                e.preventDefault();
                e.stopPropagation();
            }
            //ctrl+p
            if (e.ctrlKey && e.keyCode == 80){
                ctrl.printSurat();
                e.preventDefault();
                e.stopPropagation();
            }
        }
        document.addEventListener('keyup', keyup, false);

        let bundleSchemas = {
           "penduduk": schemas.penduduk,
           "surat": []
        };

        let bundleData = {
            "penduduk": [],
            "surat": []
        };

        let me = this;
        
        v2Dataapi.getContent("penduduk", null, bundleData, bundleSchemas, (content) => { 
            me.completeData = JSON.parse(JSON.stringify(content));
          
            $("#loader").addClass("hidden");
            
            me.initialData = content.length > me.maxPaging ? me.getData(me.completeData, me.page) : me.completeData;

            hot.loadData(me.initialData);      
      
            setTimeout(function(){
                if(me.initialData.length == 0)
                    $(emptyContainer).removeClass("hidden");
                else 
                    $(sheetContainer).removeClass("hidden");
                hot.render();
                ctrl.loaded = true;
                ctrl.appRef.tick();
            },500);
        });
        
        this.initDiffComponent();
    }

    getData(data, page): any[] {
        let limit = this.maxPaging;
        let row  = (page - 1) * limit;
        let count = page * limit;
        let part  = [];

        for (;row < count;row++){
            if(!data[row])
                continue;

            part.push(data[row]);
        }
        return part;
    }

    importExcel(){
        var files = remote.dialog.showOpenDialog(null);
        if(files && files.length){
            this.importer.init(files[0]);
            $("#modal-import-columns").modal("show");
        }
    }

    doImport(overwrite){
        $("#modal-import-columns").modal("hide");
        var objData = this.importer.getResults();
        
        var existing = overwrite ? [] : hot.getSourceData();
        var imported = objData.map(o => schemas.objToArray(o, schemas.penduduk));
        var data = existing.concat(imported);
        console.log(existing.length, imported.length, data.length);

        hot.loadData(data);
        $(emptyContainer).addClass("hidden");
        $(sheetContainer).removeClass("hidden");
        setTimeout(function(){
            //hot.validateCells();
            hot.render();
        },500);
    }

    exportExcel(){        
        var data = hot.getData();
        exportPenduduk(data, "Data Penduduk");
    }

    filterContent(){ 
        var plugin = hot.getPlugin('hiddenColumns');        
        var value = $('input[name=btn-filter]:checked').val();   
        var fields = schemas.penduduk.map(c => c.field);
        var result = spliceArray(fields,showColumns[value]);

        plugin.showColumns(resultBefore);
        if(value==0)plugin.showColumns(result);
        else plugin.hideColumns(result);
        hot.render();
        resultBefore = result;
    }

    insertRow(){
        $(emptyContainer).addClass("hidden");
        $(sheetContainer).removeClass("hidden");
        hot.alter("insert_row", 0);
        hot.selectCell(0, 0, 0, 0, true);
    }
    
    saveContent(){
        $("#modal-save-diff").modal("hide");
        this.savingMessage = "Menyimpan...";
        var timestamp = new Date().getTime();
        var content = hot.getSourceData();
        var that = this;
        
        let bundleSchemas = {
           "penduduk": schemas.penduduk,
           "surat": []
        };

        let bundleData = {
            "penduduk": content,
            "surat": []
        };

        let me = this;

        v2Dataapi.saveContent("penduduk", null, bundleData, bundleSchemas, (err, data) => {
            that.savingMessage = "Penyimpanan berhasil";

            if(!err)
                that.initialData = data;

            hot.loadData(data);
            that.afterSave();

            setTimeout(function(){
                that.savingMessage = null;
            }, 2000);
        });

        return false;
    }
    
    showFileMenu(isFileMenuShown){
        this.isFileMenuShown = isFileMenuShown;
        this.printSurat = false;
        if(isFileMenuShown)
            $(".titlebar").removeClass("blue");
        else
            $(".titlebar").addClass("blue");
    }

    next(): boolean {
        this.page += 1;
        this.initialData = this.getData(this.completeData, this.page);
        hot.loadData(this.initialData);
        return false;
    }

    prev(): boolean {
        if(this.page == 1)
           return false;

        this.page -= 1;
        this.initialData = this.getData(this.completeData, this.page);
        hot.loadData(this.initialData);
        return false;
    }
}

PendudukComponent['parameters'] = [ApplicationRef];
export default PendudukComponent;
